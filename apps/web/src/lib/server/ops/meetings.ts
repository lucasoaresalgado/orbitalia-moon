// Meetings (scope §9): agents (internal and external) meet on a topic in rounds;
// the worker runs the rounds, internal turns and the minutes. Any door can start
// one, read it, post a turn (a participant agent, or Lucas), and end it.
import { z } from "zod";
import { CHANNELS, MeetingTurn, type MeetingTurn as Turn } from "@miniasys/core";
import { agents, expectedSpeakers, meetingParticipants, meetings, meetingView, MeetingError, postTurn, publish, spokeThisRound, startMeeting, transcript, turnText, eq, inArray } from "@miniasys/db";
import { database, db, sql } from "../db.ts";
import { sendJob } from "../jobs.ts";
import { audit, defineOp, OpError } from "./define.ts";
import { AgentRef, projectBySlug, ProjectRef, Uuid } from "./common.ts";

const MeetingRef = Uuid.describe("meeting id");
const asOp = async <T>(f: () => Promise<T>) => {
  try {
    return await f();
  } catch (e) {
    if (e instanceof MeetingError) throw new OpError(e.status, e.message);
    throw e;
  }
};

export const start = defineOp({
  name: "meetings.start",
  summary: "Start a meeting on a project between agents (internal ones speak through the worker, external ones post with meetings.post). Round 1: updates; later rounds: answers to questions; it closes with minutes, and action items become cards.",
  access: "write",
  input: z.object({
    project: ProjectRef,
    topic: z.string().trim().min(3).max(200),
    agenda: z.string().max(10_000).default("").describe("what the meeting should settle (markdown)"),
    participants: z.array(AgentRef).min(1).max(8).describe("agent slugs"),
    max_rounds: z.number().int().min(1).max(6).default(3),
    round_minutes: z.number().int().min(1).max(1440).default(10).describe("how long external participants get to post each round"),
  }),
  run: async (ctx, i) => {
    const p = await projectBySlug(i.project);
    const slugs = [...new Set(i.participants.map((x) => x.replace(/^a\//, "")))];
    const rows = await db().select({ id: agents.id, slug: agents.slug }).from(agents).where(inArray(agents.slug, slugs));
    const missing = slugs.filter((s) => !rows.some((r) => r.slug === s));
    if (missing.length) throw new OpError(404, `no agent ${missing.map((s) => `a/${s}`).join(", ")}`);
    const m = await asOp(() => startMeeting(database(), { projectId: p.id, topic: i.topic, agenda: i.agenda, participantIds: rows.map((r) => r.id), maxRounds: i.max_rounds, roundMinutes: i.round_minutes, createdBy: ctx.actor }));
    await audit(ctx, "meeting.start", { type: "meeting", id: m.id }, { topic: i.topic, participants: slugs });
    // round 1 is open: the worker takes the internal turns and tells the external participants
    await sendJob("meeting.step", { meetingId: m.id, opened: 1 });
    return { id: m.id, topic: m.topic, participants: slugs, round: 1, roundDeadline: m.roundDeadline };
  },
});

export const list = defineOp({
  name: "meetings.list",
  summary: "List meetings, newest first, optionally for one project or status (running, closed).",
  access: "read",
  input: z.object({ project: ProjectRef.optional(), status: z.enum(["running", "closing", "minutes", "closed"]).optional(), limit: z.number().int().min(1).max(200).default(50) }),
  run: async (_c, i) => {
    const pid = i.project ? (await projectBySlug(i.project)).id : null;
    return sql()<{ id: string; project: string; topic: string; status: string; round: number; max_rounds: number; participants: string[]; created_at: Date; closed_at: Date | null }[]>`
      SELECT m.id, p.slug AS project, m.topic, m.status, m.round, m.max_rounds,
        ARRAY(SELECT a.slug FROM meeting_participants mp JOIN agents a ON a.id = mp.agent_id WHERE mp.meeting_id = m.id ORDER BY a.slug) AS participants,
        m.created_at, m.closed_at
      FROM meetings m JOIN projects p ON p.id = m.project_id
      WHERE (${pid}::uuid IS NULL OR m.project_id = ${pid}) AND (${i.status ?? null}::text IS NULL OR m.status = ${i.status ?? null})
      ORDER BY m.created_at DESC LIMIT ${i.limit}`;
  },
});

export const get = defineOp({
  name: "meetings.get",
  summary: "A meeting: topic, agenda, round, who is expected to speak now (and before when), every message, and the minutes once closed. Read it before posting your turn.",
  access: "read",
  input: z.object({ meeting: MeetingRef, transcript: z.boolean().default(false).describe("also return the whole meeting as markdown") }),
  run: async (ctx, i) =>
    asOp(async () => {
      const v = await meetingView(database(), i.meeting);
      const spoke = spokeThisRound(v);
      const expected = v.meeting.status === "running" ? expectedSpeakers(v).map((p) => ({ agent: p.slug, runtime: p.runtime, posted: spoke.has(p.id) })) : [];
      const bySlug = new Map(v.participants.map((p) => [p.id, p.slug]));
      const you = ctx.agent ? expected.find((e) => e.agent === ctx.agent!.slug) : undefined;
      return {
        meeting: v.meeting,
        participants: v.participants.map((p) => ({ slug: p.slug, name: p.name, role: p.role, runtime: p.runtime })),
        expected,
        ...(ctx.agent ? { yourTurn: !!you && !you.posted } : {}),
        messages: v.messages.map((m) => ({ id: m.id, round: m.round, kind: m.kind, actor: m.actor, agent: m.agentId ? bySlug.get(m.agentId) ?? null : null, content: m.content, createdAt: m.createdAt })),
        ...(i.transcript ? { transcript: transcript(v) } : {}),
      };
    }),
});

export const post = defineOp({
  name: "meetings.post",
  summary: "Post your turn in a meeting's current round: as a participant agent, one turn per round (round 1: done/next/blockers; later: answers to questions for you); as Lucas, any message. Questions to others and action items (future cards) are welcome in any round.",
  access: "write",
  input: MeetingTurn.extend({ meeting: MeetingRef }),
  run: async (ctx, { meeting, ...turn }) =>
    asOp(async () => {
      const r = await postTurn(database(), meeting, { agentId: ctx.agent?.id ?? null, actor: ctx.actor }, turn);
      await audit(ctx, "meeting.post", { type: "meeting", id: meeting }, { round: r.round, summary: turnText(ctx.actor, MeetingTurn.parse(turn) as Turn).slice(0, 300) });
      // the worker checks whether the round is complete
      await sendJob("meeting.step", { meetingId: meeting });
      return r;
    }),
});

export const invite = defineOp({
  name: "meetings.invite",
  summary: "Add an agent to a running meeting; it speaks from the next round it is asked something.",
  access: "write",
  input: z.object({ meeting: MeetingRef, agent: AgentRef }),
  run: async (ctx, i) => {
    const [m] = await db().select().from(meetings).where(eq(meetings.id, i.meeting));
    if (!m) throw new OpError(404, `no meeting ${i.meeting}`);
    if (m.status !== "running") throw new OpError(409, `the meeting is ${m.status}`);
    const [a] = await db().select().from(agents).where(eq(agents.slug, i.agent));
    if (!a) throw new OpError(404, `no agent a/${i.agent}`);
    await db().insert(meetingParticipants).values({ meetingId: m.id, agentId: a.id }).onConflictDoNothing();
    await audit(ctx, "meeting.invite", { type: "meeting", id: m.id }, { agent: a.slug });
    await publish(sql(), { topic: CHANNELS.meeting(m.id), type: "participants", data: {} });
    return { ok: true };
  },
});

export const end = defineOp({
  name: "meetings.end",
  summary: "End a running meeting now: the minutes are written and its action items become cards.",
  access: "write",
  input: z.object({ meeting: MeetingRef }),
  run: async (ctx, i) => {
    const r = await sql()`UPDATE meetings SET status = 'closing', closed_by = ${ctx.agent ? `agent:${ctx.agent.slug}` : "user"} WHERE id = ${i.meeting} AND status = 'running' RETURNING id`;
    if (!r.length) throw new OpError(409, "the meeting is not running");
    await audit(ctx, "meeting.end", { type: "meeting", id: i.meeting });
    await sendJob("meeting.step", { meetingId: i.meeting });
    return { ok: true };
  },
});
