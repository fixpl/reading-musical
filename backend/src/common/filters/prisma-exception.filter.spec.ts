import { BaseExceptionFilter } from "@nestjs/core";
import { Prisma } from "@prisma/client";
import { PrismaExceptionFilter } from "./prisma-exception.filter";

function run(code: string) {
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  const host = { getType: () => "http", switchToHttp: () => ({ getResponse: () => ({ status }) }) };
  new PrismaExceptionFilter().catch(new Prisma.PrismaClientKnownRequestError("x", { code, clientVersion: "test" }), host as never);
  return { status, json };
}

describe("PrismaExceptionFilter", () => {
  test.each([
    ["P2002", 409],
    ["P2003", 409],
    ["P2025", 404],
    ["P2028", 409],
    ["P2034", 409]
  ])("%s maps to %i with a Korean message", (code, expected) => {
    const { status, json } = run(code);
    expect(status).toHaveBeenCalledWith(expected);
    expect(json.mock.calls[0][0].message).toMatch(/요/);
  });

  test("unmapped codes and non-http contexts are delegated to Nest's default handler", () => {
    const base = jest.spyOn(BaseExceptionFilter.prototype, "catch").mockImplementation(() => undefined);
    const error = new Prisma.PrismaClientKnownRequestError("x", { code: "P2010", clientVersion: "test" });
    const status = jest.fn();
    const http = { getType: () => "http", switchToHttp: () => ({ getResponse: () => ({ status }) }) };
    const ws = { getType: () => "ws", switchToHttp: () => ({ getResponse: () => ({ status }) }) };
    const filter = new PrismaExceptionFilter();
    filter.catch(error, http as never);
    const mappedError = new Prisma.PrismaClientKnownRequestError("x", { code: "P2002", clientVersion: "test" });
    filter.catch(mappedError, ws as never);
    expect(base).toHaveBeenCalledTimes(2);
    expect(status).not.toHaveBeenCalled();
    base.mockRestore();
  });
});
