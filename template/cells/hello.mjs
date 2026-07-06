// A CELL: a plain ES module exporting async functions of shape (args) => result.
// It is content-addressed (pinned by sha8) and verified before it is ever executed.
// No imports of the host, no side effects beyond returning a value. Keep it pure & portable.
export async function hello({ name = "world" } = {}) {
  return { message: `hello, ${name}!`, proof: "you are running a verified rapp-static-mcp cell" };
}
