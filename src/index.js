import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { parseReleases, parseSecurityAnnouncements } from "./util.js";
import fetch from "node-fetch";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

const server = new McpServer({
  name: "demo-server",
  version: "1.0.0",
});

server.registerTool(
  "get-desktop-releases",
  {
    title: "Get Docker Desktop Release Notes",
    description: "Get information about the latest Docker Desktop releases",
    inputSchema: {
      limit: z
        .number()
        .min(1)
        .max(10)
        .default(6)
        .optional()
        .describe("Number of releases to return"),
    },
  },
  async ({ limit = 6 }) => {
    const data = (
      await fetch("https://docs.docker.com/desktop/release-notes/index.md")
    ).text();

    return {
      content: [
        {
          type: "text",
          text: parseReleases(await data, limit),
        },
      ],
    };
  },
);

server.registerTool(
  "get-security-details",
  {
    title: "Get Docker Desktop Security Details",
    description:
      "Get information about the latest Docker Desktop security updates",
    inputSchema: {
      limit: z
        .number()
        .min(1)
        .max(10)
        .default(6)
        .optional()
        .describe("Number of security updates to return"),
    },
  },
  async ({ limit = 6 }) => {
    const data = (
      await fetch(
        "https://docs.docker.com/security/security-announcements/index.md",
      )
    ).text();

    return {
      content: [
        {
          type: "text",
          text: parseSecurityAnnouncements(await data, limit),
        },
      ],
    };
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);