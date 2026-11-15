import { NotificationsGateway } from "./notifications.gateway";

type Handshake = { auth?: Record<string, unknown>; query?: Record<string, unknown>; headers: Record<string, unknown> };
const socket = (handshake: Handshake) => ({ handshake, emit: jest.fn(), disconnect: jest.fn(), join: jest.fn(), data: {} }) as never;

describe("NotificationsGateway handshake tokens", () => {
  const gateway = new NotificationsGateway({} as never, {} as never, {} as never);
  const extractToken = (client: unknown) => (gateway as unknown as { extractToken(c: unknown): string | null }).extractToken(client);
  const extractGuest = (client: unknown) => (gateway as unknown as { extractGuestReadingToken(c: unknown): string | null }).extractGuestReadingToken(client);

  test("reads token from auth and Authorization header", () => {
    expect(extractToken(socket({ auth: { token: "abc" }, headers: {} }))).toBe("abc");
    expect(extractToken(socket({ headers: { authorization: "Bearer xyz" } }))).toBe("xyz");
  });

  test("ignores token in query string", () => {
    expect(extractToken(socket({ query: { token: "leaky" }, headers: {} }))).toBeNull();
  });

  test("reads guest token from auth only", () => {
    expect(extractGuest(socket({ auth: { guestReadingToken: "g1" }, headers: {} }))).toBe("g1");
    expect(extractGuest(socket({ query: { guestReadingToken: "g2", guestToken: "g3" }, headers: {} }))).toBeNull();
  });

  test("rejects a connection that only sends a query token", async () => {
    const client = socket({ query: { token: "leaky" }, headers: {} }) as unknown as { emit: jest.Mock; disconnect: jest.Mock };
    await gateway.handleConnection(client as never);
    expect(client.disconnect).toHaveBeenCalledWith(true);
  });
});
