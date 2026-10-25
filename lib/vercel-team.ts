import { getVercelOidcToken } from "@vercel/oidc";

/**
 * The Vercel team (account) this deployment belongs to, read from the deployment's own OIDC identity
 * (its `owner_id` claim). Team-scoped access tokens need this as `teamId` on every API call, and
 * such tokens usually aren't allowed to list teams themselves. Null outside Vercel.
 */
export async function deploymentTeamId(): Promise<string | null> {
  try {
    const token = await getVercelOidcToken();
    const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8")) as { owner_id?: unknown };
    return typeof payload.owner_id === "string" && payload.owner_id ? payload.owner_id : null;
  } catch {
    return null;
  }
}
