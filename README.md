# MCP Wrapper for Vincent

The purpose of this is a PoC to show that we can wrap MCPs, and someday, apply policies to them.

This currently wraps any STDIO based local MCP and exposes it as a Streamable HTTP server. We simply log the requests and responses to show that we could modify, filter them, or apply policies to them.
