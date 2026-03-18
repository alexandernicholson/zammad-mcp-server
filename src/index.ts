#!/usr/bin/env node
/**
 * Zammad MCP Server
 *
 * Exposes Zammad helpdesk operations as MCP tools for AI agents.
 * Covers: tickets, articles, users, organizations, groups, roles,
 * tags, links, knowledge base (search/CRUD), notifications, and global search.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { ZammadClient } from "./zammad-client.js";

const client = new ZammadClient();
const server = new McpServer({
  name: "zammad",
  version: "1.0.0",
});

// ── Helpers ─────────────────────────────────────────────────

// Coerce string→number since some LLMs pass numbers as strings
const zid = z.coerce.number();
const znum = z.coerce.number();

function json(data: unknown): string {
  return JSON.stringify(data, null, 2);
}

function ok(data: unknown) {
  return { content: [{ type: "text" as const, text: json(data) }] };
}

async function handle(fn: () => Promise<unknown>) {
  try {
    return ok(await fn());
  } catch (e) {
    return { content: [{ type: "text" as const, text: `Error: ${e instanceof Error ? e.message : String(e)}` }], isError: true };
  }
}

// ── Tickets ─────────────────────────────────────────────────

server.tool("search_tickets", "Search tickets by query (e.g. customer email, keyword, ticket number)", {
  query: z.string().describe("Search query"),
  limit: z.coerce.number().optional().describe("Max results (default 10)"),
}, (args) => handle(() => client.ticketsSearch(args.query, args.limit)));

server.tool("list_tickets", "List tickets with pagination", {
  page: z.coerce.number().optional().describe("Page number (default 1)"),
  per_page: z.coerce.number().optional().describe("Results per page (default 50)"),
}, (args) => handle(() => client.ticketsAll(args.page, args.per_page)));

server.tool("get_ticket", "Get a ticket by ID with full details", {
  id: z.coerce.number().describe("Ticket ID"),
}, (args) => handle(() => client.ticketsFind(args.id)));

server.tool("create_ticket", "Create a new support ticket", {
  title: z.string().describe("Ticket title/subject"),
  group: z.string().describe("Group name (e.g. 'Users')"),
  customer: z.string().describe("Customer email address"),
  body: z.string().describe("Initial message body"),
  type: z.string().optional().describe("Article type: note, email, phone (default: note)"),
  priority_id: z.coerce.number().optional().describe("Priority ID (1=low, 2=normal, 3=high)"),
  state_id: z.coerce.number().optional().describe("State ID (1=new, 2=open, 3=pending reminder, 4=closed)"),
  tags: z.string().optional().describe("Comma-separated tags"),
}, (args) => handle(() => client.ticketsCreate(args)));

server.tool("update_ticket", "Update a ticket's properties (state, priority, group, owner, title)", {
  id: z.coerce.number().describe("Ticket ID"),
  title: z.string().optional().describe("New title"),
  group: z.string().optional().describe("New group name"),
  state: z.string().optional().describe("New state name (new, open, closed, etc.)"),
  priority_id: z.coerce.number().optional().describe("New priority ID"),
  owner_id: z.coerce.number().optional().describe("New owner user ID"),
}, (args) => {
  const { id, ...data } = args;
  return handle(() => client.ticketsUpdate(id, data));
});

server.tool("delete_ticket", "Delete a ticket (admin only, permanent)", {
  id: z.coerce.number().describe("Ticket ID"),
}, (args) => handle(() => client.ticketsDestroy(args.id)));

server.tool("merge_tickets", "Merge a ticket into another ticket", {
  source_id: z.coerce.number().describe("Ticket ID to merge (will be closed)"),
  target_id: z.coerce.number().describe("Ticket ID to merge into"),
}, (args) => handle(() => client.ticketsMerge(args.source_id, args.target_id)));

// ── Ticket Articles ─────────────────────────────────────────

server.tool("get_ticket_articles", "Get all articles/messages for a ticket", {
  ticket_id: z.coerce.number().describe("Ticket ID"),
}, (args) => handle(() => client.ticketArticlesForTicket(args.ticket_id)));

server.tool("get_article", "Get a specific article by ID", {
  id: z.coerce.number().describe("Article ID"),
}, (args) => handle(() => client.ticketArticlesFind(args.id)));

server.tool("add_article", "Add a note or reply to a ticket", {
  ticket_id: z.coerce.number().describe("Ticket ID"),
  body: z.string().describe("Message body"),
  subject: z.string().optional().describe("Subject line"),
  type: z.string().optional().describe("Type: note, email, phone (default: note)"),
  internal: z.boolean().optional().describe("Internal note only visible to agents (default: true)"),
}, (args) => handle(() => client.ticketArticlesCreate(args)));

// ── Tags ────────────────────────────────────────────────────

server.tool("get_ticket_tags", "Get tags for a ticket", {
  ticket_id: z.coerce.number().describe("Ticket ID"),
}, (args) => handle(() => client.tagsForTicket(args.ticket_id)));

server.tool("add_ticket_tag", "Add a tag to a ticket", {
  ticket_id: z.coerce.number().describe("Ticket ID"),
  tag: z.string().describe("Tag name"),
}, (args) => handle(() => client.tagsAdd(args.ticket_id, args.tag)));

server.tool("remove_ticket_tag", "Remove a tag from a ticket", {
  ticket_id: z.coerce.number().describe("Ticket ID"),
  tag: z.string().describe("Tag name"),
}, (args) => handle(() => client.tagsRemove(args.ticket_id, args.tag)));

server.tool("list_tags", "List all available tags", {}, () => handle(() => client.tagListAll()));

// ── Links ───────────────────────────────────────────────────

server.tool("get_ticket_links", "Get linked tickets for a ticket", {
  ticket_id: z.coerce.number().describe("Ticket ID"),
}, (args) => handle(() => client.linksGet(args.ticket_id)));

server.tool("link_tickets", "Link two tickets together", {
  source_id: z.coerce.number().describe("Source ticket ID"),
  target_id: z.coerce.number().describe("Target ticket ID"),
  link_type: z.string().optional().describe("Link type: normal (default), parent, child"),
}, (args) => handle(() => client.linksAdd(args.source_id, args.target_id, args.link_type)));

server.tool("unlink_tickets", "Remove link between two tickets", {
  source_id: z.coerce.number().describe("Source ticket ID"),
  target_id: z.coerce.number().describe("Target ticket ID"),
  link_type: z.string().optional().describe("Link type to remove (default: normal)"),
}, (args) => handle(() => client.linksRemove(args.source_id, args.target_id, args.link_type)));

// ── Users ───────────────────────────────────────────────────

server.tool("search_users", "Search users by name or email", {
  query: z.string().describe("Search query"),
  limit: z.coerce.number().optional().describe("Max results"),
}, (args) => handle(() => client.usersSearch(args.query, args.limit)));

server.tool("get_user", "Get a user by ID", {
  id: z.coerce.number().describe("User ID"),
}, (args) => handle(() => client.usersFind(args.id)));

server.tool("list_users", "List users with pagination", {
  page: z.coerce.number().optional(),
  per_page: z.coerce.number().optional(),
}, (args) => handle(() => client.usersAll(args.page, args.per_page)));

server.tool("create_user", "Create a new user", {
  email: z.string().describe("Email address"),
  firstname: z.string().describe("First name"),
  lastname: z.string().describe("Last name"),
  organization: z.string().optional().describe("Organization name"),
}, (args) => handle(() => client.usersCreate(args)));

server.tool("update_user", "Update a user", {
  id: z.coerce.number().describe("User ID"),
  email: z.string().optional(),
  firstname: z.string().optional(),
  lastname: z.string().optional(),
}, (args) => {
  const { id, ...data } = args;
  return handle(() => client.usersUpdate(id, data));
});

server.tool("whoami", "Get the current authenticated user", {}, () => handle(() => client.usersMe()));

// ── Organizations ───────────────────────────────────────────

server.tool("search_organizations", "Search organizations", {
  query: z.string().describe("Search query"),
  limit: z.coerce.number().optional(),
}, (args) => handle(() => client.organizationsSearch(args.query, args.limit)));

server.tool("get_organization", "Get an organization by ID", {
  id: z.coerce.number().describe("Organization ID"),
}, (args) => handle(() => client.organizationsFind(args.id)));

server.tool("list_organizations", "List organizations with pagination", {
  page: z.coerce.number().optional(),
  per_page: z.coerce.number().optional(),
}, (args) => handle(() => client.organizationsAll(args.page, args.per_page)));

server.tool("create_organization", "Create a new organization", {
  name: z.string().describe("Organization name"),
}, (args) => handle(() => client.organizationsCreate(args)));

// ── Groups & Roles ──────────────────────────────────────────

server.tool("list_groups", "List all groups (for ticket assignment)", {}, () => handle(() => client.groupsAll()));
server.tool("get_group", "Get a group by ID", { id: z.coerce.number() }, (args) => handle(() => client.groupsFind(args.id)));
server.tool("list_roles", "List all roles", {}, () => handle(() => client.rolesAll()));
server.tool("get_role", "Get a role by ID", { id: z.coerce.number() }, (args) => handle(() => client.rolesFind(args.id)));

// ── Ticket States & Priorities ──────────────────────────────

server.tool("list_ticket_states", "List all ticket states (new, open, closed, etc.)", {}, () => handle(() => client.ticketStatesAll()));
server.tool("list_ticket_priorities", "List all ticket priorities", {}, () => handle(() => client.ticketPrioritiesAll()));

// ── Notifications ───────────────────────────────────────────

server.tool("list_notifications", "List online notifications", {
  page: z.coerce.number().optional(),
  per_page: z.coerce.number().optional(),
}, (args) => handle(() => client.notificationsAll(args.page, args.per_page)));

server.tool("get_notification", "Get a notification by ID", {
  id: z.coerce.number().describe("Notification ID"),
}, (args) => handle(() => client.notificationsFind(args.id)));

server.tool("mark_all_notifications_read", "Mark all notifications as read", {}, () => handle(() => client.notificationsMarkAllRead()));

// ── Object Manager Attributes ───────────────────────────────

server.tool("list_object_attributes", "List custom object/field definitions", {}, () => handle(() => client.objectsAll()));
server.tool("get_object_attribute", "Get a custom object attribute by ID", {
  id: z.coerce.number(),
}, (args) => handle(() => client.objectsFind(args.id)));

// ── Knowledge Base ──────────────────────────────────────────

server.tool("search_knowledge_base", "Search the knowledge base for answers", {
  query: z.string().describe("Search query"),
}, (args) => handle(() => client.kbSearch(args.query)));

server.tool("kb_init", "Get full knowledge base structure (categories, answers, locales)", {}, () => handle(() => client.kbInit()));

server.tool("get_kb_answer", "Get a knowledge base answer by ID", {
  id: z.coerce.number().describe("Answer ID"),
}, (args) => handle(() => client.kbAnswerFind(args.id)));

server.tool("create_kb_answer", "Create a new knowledge base article", {
  category_id: z.coerce.number().describe("Category ID to place the answer in"),
  title: z.string().describe("Article title"),
  body: z.string().describe("Article content (HTML supported)"),
}, (args) => handle(() => client.kbAnswerCreate(args)));

server.tool("update_kb_answer", "Update a knowledge base article", {
  id: z.coerce.number().describe("Answer ID"),
  translation_id: z.coerce.number().describe("Translation ID (from the answer object)"),
  title: z.string().optional().describe("New title"),
  body: z.string().optional().describe("New content"),
  category_id: z.coerce.number().optional().describe("Move to a different category"),
}, (args) => {
  const { id, ...data } = args;
  return handle(() => client.kbAnswerUpdate(id, data));
});

server.tool("delete_kb_answer", "Delete a knowledge base answer", {
  id: z.coerce.number().describe("Answer ID"),
}, (args) => handle(() => client.kbAnswerDestroy(args.id)));

server.tool("publish_kb_answer", "Publish a knowledge base answer (make it visible)", {
  id: z.coerce.number().describe("Answer ID"),
}, (args) => handle(() => client.kbAnswerPublish(args.id)));

server.tool("archive_kb_answer", "Archive a knowledge base answer", {
  id: z.coerce.number().describe("Answer ID"),
}, (args) => handle(() => client.kbAnswerArchive(args.id)));

server.tool("internal_kb_answer", "Set a knowledge base answer to internal-only", {
  id: z.coerce.number().describe("Answer ID"),
}, (args) => handle(() => client.kbAnswerInternal(args.id)));

server.tool("add_kb_translation", "Add a translation to an existing knowledge base answer (e.g. Japanese version)", {
  answer_id: z.coerce.number().describe("Answer ID to add translation to"),
  kb_locale_id: z.coerce.number().describe("KB locale ID (use list_kb_locales to find IDs)"),
  title: z.string().describe("Translated title"),
  body: z.string().describe("Translated content (HTML supported)"),
  category_id: z.coerce.number().describe("Category ID (required by Zammad API)"),
}, (args) => handle(() => client.kbAnswerAddTranslation(args.answer_id, {
  kb_locale_id: args.kb_locale_id,
  title: args.title,
  body: args.body,
  category_id: args.category_id,
})));

server.tool("list_kb_locales", "List available knowledge base locales (languages)", {}, () => handle(() => client.kbLocales()));

server.tool("get_kb_category", "Get a knowledge base category by ID", {
  id: z.coerce.number().describe("Category ID"),
}, (args) => handle(() => client.kbCategoryFind(args.id)));

server.tool("create_kb_category", "Create a new knowledge base category", {
  title: z.string().describe("Category title"),
  icon: z.string().optional().describe("Font Awesome icon code (default: f115)"),
  parent_id: z.coerce.number().optional().describe("Parent category ID for subcategories"),
}, (args) => handle(() => client.kbCategoryCreate(args)));

server.tool("update_kb_category", "Update a knowledge base category", {
  id: z.coerce.number().describe("Category ID"),
  translation_id: z.coerce.number().describe("Translation ID"),
  title: z.string().optional().describe("New title"),
  icon: z.string().optional().describe("New icon code"),
  parent_id: z.coerce.number().optional().describe("New parent category"),
}, (args) => {
  const { id, ...data } = args;
  return handle(() => client.kbCategoryUpdate(id, data));
});

server.tool("delete_kb_category", "Delete a knowledge base category", {
  id: z.coerce.number().describe("Category ID"),
}, (args) => handle(() => client.kbCategoryDestroy(args.id)));

// ── Global Search ───────────────────────────────────────────

server.tool("global_search", "Search across all Zammad resources (tickets, users, organizations)", {
  query: z.string().describe("Search query"),
  limit: z.coerce.number().optional().describe("Max results (default 10)"),
}, (args) => handle(() => client.globalSearch(args.query, args.limit)));

// ── Start ───────────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Zammad MCP server running on stdio");
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
