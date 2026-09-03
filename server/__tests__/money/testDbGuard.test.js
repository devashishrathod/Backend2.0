const { toTestUri, TEST_DB_SUFFIX } = require("./setup/testDb");

/**
 * The guard that keeps these tests off the development database.
 *
 * Everything else in this folder deletes documents. If the connection helper
 * ever pointed at `Trydood2` instead of `Trydood2_test`, the first `beforeEach`
 * would wipe real data — silently, and in under a second.
 *
 * So the guard is tested like any other piece of the money path. Nothing here
 * touches the network.
 */
describe("the test database name is derived safely", () => {
  it("appends the suffix to a plain connection string", () => {
    const out = toTestUri("mongodb://localhost:27017/Trydood2");
    expect(new URL(out).pathname).toBe(`/Trydood2${TEST_DB_SUFFIX}`);
  });

  it("keeps query options intact", () => {
    const out = toTestUri(
      "mongodb+srv://user:pw@cluster.example.net/Trydood2?retryWrites=true&w=majority",
    );
    const parsed = new URL(out);
    expect(parsed.pathname).toBe(`/Trydood2${TEST_DB_SUFFIX}`);
    expect(parsed.searchParams.get("retryWrites")).toBe("true");
    expect(parsed.searchParams.get("w")).toBe("majority");
  });

  /**
   * The reason this is parsed with `URL` and not a regular expression.
   *
   * Atlas passwords routinely contain `/` and `@` once URL-encoded, and a regex
   * that looks correct against one credential set matches the wrong slash in
   * another — quietly renaming part of the password instead of the database.
   */
  it("is not fooled by a password containing slashes and at-signs", () => {
    const out = toTestUri(
      "mongodb+srv://admin:p%2Fa%40ss%2Fword@cluster.example.net/Trydood2?authSource=admin",
    );
    const parsed = new URL(out);
    expect(parsed.pathname).toBe(`/Trydood2${TEST_DB_SUFFIX}`);
    // The credential survived untouched.
    expect(out).toContain("admin:p%2Fa%40ss%2Fword@");
  });

  it("falls back to a named database when the string has none", () => {
    const out = toTestUri("mongodb+srv://user:pw@cluster.example.net/?w=majority");
    expect(new URL(out).pathname).toBe(`/Trydood2${TEST_DB_SUFFIX}`);
  });

  it("is idempotent — a string already pointing at the test db is unchanged", () => {
    const already = "mongodb://localhost:27017/Trydood2_test";
    expect(toTestUri(already)).toBe(already);
  });

  it("never returns a database name without the suffix", () => {
    for (const uri of [
      "mongodb://localhost:27017/Trydood2",
      "mongodb://localhost:27017/production",
      "mongodb+srv://u:p@host/Trydood2?retryWrites=true",
      "mongodb+srv://u:p@host/",
    ]) {
      const name = decodeURIComponent(new URL(toTestUri(uri)).pathname.slice(1));
      expect(name.endsWith(TEST_DB_SUFFIX)).toBe(true);
    }
  });

  it("refuses to guess when MONGO_URL is missing", () => {
    // Better a clear failure than a connection to whatever the default is.
    expect(() => toTestUri(undefined)).toThrow(/MONGO_URL is not set/);
    expect(() => toTestUri("")).toThrow(/MONGO_URL is not set/);
  });
});
