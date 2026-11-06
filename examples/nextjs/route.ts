// app/apply/route.ts
import { createGuard } from "whofills/server";

const guard = createGuard({ secret: process.env.WHOFILLS_SECRET!, mode: "tag" });

export async function POST(request: Request) {
  const result = await guard.fetch(request);
  if ("response" in result) return result.response;
  // await db.applications.create({ data: { ...result.fields, agentVerdict: result.verdict?.verdict } });
  return Response.redirect(new URL("/thanks", request.url), 303);
}

/* In your page:
import { Whofills, HumanAttestation } from "whofills/react";

<form className="application" method="post" action="/apply">
  ...
  <HumanAttestation />
  <button>Submit</button>
</form>
<Whofills protect="form.application" />
*/
