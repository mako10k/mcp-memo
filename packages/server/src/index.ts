// Placeholder for MCP memory server implementation.
// TODO: Implement memory.save/search/delete handlers per docs.
export default {
  async fetch(request: Request): Promise<Response> {
    return new Response(
      JSON.stringify({ status: "not-implemented", path: new URL(request.url).pathname }),
      {
        status: 501,
        headers: { "content-type": "application/json; charset=utf-8" }
      }
    );
  }
};
