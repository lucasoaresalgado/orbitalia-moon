import { redirect } from "@sveltejs/kit";

// Deep link to a card: the board with its drawer open (scope §18.4).
export const load = ({ params }) => redirect(307, `/projects/${params.project}?card=${params.number}`);
