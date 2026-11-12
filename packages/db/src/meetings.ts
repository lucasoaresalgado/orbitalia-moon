// Meetings (scope §9), shared by the web app (operations) and the worker (which
// drives the rounds). A meeting is rounds of turns: round 1 everyone gives an
// update; each later round, the agents asked something answer. It closes when no
// questions are left (System One), when Lucas ends it, or at its round cap.
import { CHANNELS, MeetingTurn, type MeetingTurn as Turn } from "@miniasys/core";
import { and, asc, eq, inArray } from "drizzle-orm";
import { publish, type Database } from "./index.ts";
import { agents, cards, meetingMessages, meetingParticipants, meetings, projects } from "./schema.ts";
import type { Actor } from "./cards.ts";

export class MeetingError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function startMeeting(
  d: Database,
  m: { projectId: string; topic: string; agenda?: string; participantIds: string[]; maxRounds?: number; roundMinutes?: number; createdBy: Actor },
) {
  if (!m.participantIds.length) throw new MeetingError(400, "a meeting needs at least one participant");
  const people = await d.db.select().from(agents).where(inArray(agents.id, m.participantIds));
  for (const a of people) if (a.runtime !== "external" && !a.activeVersionId) throw new MeetingError(409, `a/${a.slug} has no deployed version: deploy it before it can meet`);
  const [project] = await d.db.select().from(projects).where(eq(projects.id, m.projectId));
  // round 1 opens at once, so a harness can post its update as soon as the meeting exists
  const roundMinutes = m.roundMinutes ?? 10;
  const [row] = await d.db
    .insert(meetings)
    .values({ projectId: m.projectId, topic: m.topic, agenda: m.agenda ?? "", status: "running", round: 1, roundDeadline: new Date(Date.now() + roundMinutes * 60_000), maxRounds: m.maxRounds ?? 3, roundMinutes, createdBy: m.createdBy })
    .returning();
  await d.db.insert(meetingParticipants).values(people.map((a) => ({ meetingId: row!.id, agentId: a.id })));
  const open = await d.db.select({ number: cards.number, title: cards.title, status: cards.status }).from(cards).where(and(eq(cards.projectId, m.projectId), eq(cards.status, "in_progress")));
  await d.db.insert(meetingMessages).values({
    meetingId: row!.id, round: 0, kind: "system", actor: "system",
    content: { text: `Meeting opened on p/${project?.slug}: ${m.topic}`, participants: people.map((a) => a.slug), agenda: m.agenda ?? "", cardsInProgress: open.map((c) => `#${c.number} ${c.title}`), maxRounds: row!.maxRounds },
  });
  await d.db.insert(meetingMessages).values({ meetingId: row!.id, round: 1, kind: "system", actor: "system", content: { text: `Round 1 opened (updates): ${people.map((a) => `a/${a.slug}`).join(", ")}.` } });
  await publish(d.sql, { topic: CHANNELS.meetings, type: "started", data: { id: row!.id } });
  return row!;
}

export async function meetingView(d: Database, meetingId: string) {
  const [m] = await d.db.select().from(meetings).where(eq(meetings.id, meetingId));
  if (!m) throw new MeetingError(404, `no meeting ${meetingId}`);
  const participants = await d.db
    .select({ id: agents.id, slug: agents.slug, name: agents.name, role: agents.role, runtime: agents.runtime })
    .from(meetingParticipants).innerJoin(agents, eq(agents.id, meetingParticipants.agentId))
    .where(eq(meetingParticipants.meetingId, meetingId)).orderBy(agents.slug);
  const messages = await d.db
    .select({ id: meetingMessages.id, round: meetingMessages.round, kind: meetingMessages.kind, actor: meetingMessages.actor, agentId: meetingMessages.agentId, content: meetingMessages.content, createdAt: meetingMessages.createdAt })
    .from(meetingMessages).where(eq(meetingMessages.meetingId, meetingId)).orderBy(asc(meetingMessages.id));
  return { meeting: m, participants, messages };
}

type View = Awaited<ReturnType<typeof meetingView>>;

/** Who must speak in the current round: everyone in round 1; afterwards, those asked a question last round. */
export function expectedSpeakers(v: View): { id: string; slug: string; runtime: string }[] {
  const r = v.meeting.round;
  if (r < 1) return [];
  if (r === 1) return v.participants;
  const asked = new Set(
    v.messages.filter((m) => m.round === r - 1 && (m.kind === "turn" || m.kind === "message")).flatMap((m) => ((m.content as Turn).questions ?? []).map((q) => q.to.replace(/^a\//, ""))),
  );
  return v.participants.filter((p) => asked.has(p.slug));
}

export function spokeThisRound(v: View): Set<string> {
  return new Set(v.messages.filter((m) => m.round === v.meeting.round && m.kind === "turn" && m.agentId).map((m) => m.agentId!));
}

/**
 * A turn in the current round. An agent posts once per round (a participant);
 * Lucas (no agent) may post any number of messages, with questions too.
 */
export async function postTurn(d: Database, meetingId: string, by: { agentId: string | null; actor: Actor }, turn: unknown) {
  const t = MeetingTurn.parse(turn);
  if (!t.text && !t.done && !t.next && !t.blockers && !t.answers.length && !t.questions.length && !t.action_items.length) throw new MeetingError(400, "the turn is empty");
  const v = await meetingView(d, meetingId);
  if (v.meeting.status !== "running") throw new MeetingError(409, `the meeting is ${v.meeting.status}`);
  if (v.meeting.round < 1) throw new MeetingError(409, "the meeting hasn't opened its first round yet; try again in a moment");
  if (by.agentId) {
    if (!v.participants.some((p) => p.id === by.agentId)) throw new MeetingError(403, "this agent is not a participant of the meeting");
    if (spokeThisRound(v).has(by.agentId)) throw new MeetingError(409, `already posted in round ${v.meeting.round}; wait for the next round`);
  }
  const [row] = await d.db.insert(meetingMessages).values({ meetingId, round: v.meeting.round, agentId: by.agentId, actor: by.actor, kind: by.agentId ? "turn" : "message", content: t }).returning({ id: meetingMessages.id });
  await publish(d.sql, { topic: CHANNELS.meeting(meetingId), type: "message", data: { id: row!.id, round: v.meeting.round } });
  return { id: row!.id, round: v.meeting.round };
}

/** A turn as text, for transcripts, minutes and the search index. */
export function turnText(who: string, t: Turn): string {
  const lines = [`**${who}**`];
  if (t.done) lines.push(`- done: ${t.done}`);
  if (t.next) lines.push(`- next: ${t.next}`);
  if (t.blockers) lines.push(`- blockers: ${t.blockers}`);
  for (const a of t.answers ?? []) lines.push(`- answer to ${a.to} ("${a.question}"): ${a.answer}`);
  for (const q of t.questions ?? []) lines.push(`- question for ${q.to}: ${q.question}`);
  for (const a of t.action_items ?? []) lines.push(`- action item: ${a.title}${a.assignee ? ` (for ${a.assignee})` : ""}`);
  if (t.text) lines.push(t.text);
  return lines.join("\n");
}

/** The meeting so far as markdown: what each participant (and the platform's caller) sees. */
export function transcript(v: View): string {
  const out: string[] = [`# ${v.meeting.topic}`, v.meeting.agenda ? `\n${v.meeting.agenda}` : ""];
  for (let r = 0; r <= v.meeting.round; r++) {
    const ms = v.messages.filter((m) => m.round === r);
    if (!ms.length) continue;
    out.push(`\n## Round ${r}`);
    for (const m of ms) {
      if (m.kind === "system") out.push(`_${(m.content as { text: string }).text}_`);
      else if (m.kind === "turn" || m.kind === "message") out.push(turnText(m.actor, m.content as Turn));
    }
  }
  return out.join("\n");
}
