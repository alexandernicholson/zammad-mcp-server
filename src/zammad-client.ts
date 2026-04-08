/**
 * Zammad REST API client — full parity with zammad_py SDK.
 *
 * Environment variables:
 *   ZAMMAD_URL       - Base URL (e.g. https://zammad.example.com)
 *   ZAMMAD_TOKEN     - API token
 *   ZAMMAD_KB_ID     - Knowledge base ID (default: 1)
 *   ZAMMAD_LOCALE_ID - KB locale ID (default: 1)
 */

export class ZammadClient {
  private baseUrl: string;
  private token: string;
  readonly kbId: string;
  readonly localeId: string;

  constructor() {
    const url = process.env.ZAMMAD_URL;
    const token = process.env.ZAMMAD_TOKEN;
    if (!url) throw new Error("ZAMMAD_URL environment variable is required");
    if (!token) throw new Error("ZAMMAD_TOKEN environment variable is required");
    this.baseUrl = url.replace(/\/+$/, "");
    this.token = token;
    this.kbId = process.env.ZAMMAD_KB_ID ?? "1";
    this.localeId = process.env.ZAMMAD_LOCALE_ID ?? "1";
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const url = `${this.baseUrl}/api/v1${path}`;
    const res = await fetch(url, {
      method,
      headers: {
        Authorization: `Token token=${this.token}`,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Zammad API ${method} ${path} (${res.status}): ${text}`);
    }
    return res.json() as Promise<T>;
  }

  // ── Generic CRUD helpers ────────────────────────────────

  private all(resource: string, page = 1, perPage = 50) {
    return this.request<unknown[]>("GET", `/${resource}?page=${page}&per_page=${perPage}&expand=true`);
  }
  private find(resource: string, id: number) {
    return this.request<unknown>("GET", `/${resource}/${id}?expand=true`);
  }
  private search(resource: string, query: string, limit = 10) {
    return this.request<unknown[]>("GET", `/${resource}/search?query=${encodeURIComponent(query)}&limit=${limit}&expand=true`);
  }
  private create(resource: string, data: unknown) {
    return this.request<unknown>("POST", `/${resource}`, data);
  }
  private update(resource: string, id: number, data: unknown) {
    return this.request<unknown>("PUT", `/${resource}/${id}`, data);
  }
  private destroy(resource: string, id: number) {
    return this.request<unknown>("DELETE", `/${resource}/${id}`);
  }

  // ── Users ───────────────────────────────────────────────

  usersAll(page?: number, perPage?: number) { return this.all("users", page, perPage); }
  usersFind(id: number) { return this.find("users", id); }
  usersSearch(query: string, limit?: number) { return this.search("users", query, limit); }
  usersCreate(data: unknown) { return this.create("users", data); }
  usersUpdate(id: number, data: unknown) { return this.update("users", id, data); }
  usersMe() { return this.request<unknown>("GET", "/users/me?expand=true"); }

  // ── Organizations ───────────────────────────────────────

  organizationsAll(page?: number, perPage?: number) { return this.all("organizations", page, perPage); }
  organizationsFind(id: number) { return this.find("organizations", id); }
  organizationsSearch(query: string, limit?: number) { return this.search("organizations", query, limit); }
  organizationsCreate(data: unknown) { return this.create("organizations", data); }
  organizationsUpdate(id: number, data: unknown) { return this.update("organizations", id, data); }

  // ── Groups ──────────────────────────────────────────────

  groupsAll(page?: number, perPage?: number) { return this.all("groups", page, perPage); }
  groupsFind(id: number) { return this.find("groups", id); }

  // ── Roles ───────────────────────────────────────────────

  rolesAll(page?: number, perPage?: number) { return this.all("roles", page, perPage); }
  rolesFind(id: number) { return this.find("roles", id); }

  // ── Tickets ─────────────────────────────────────────────

  ticketsAll(page?: number, perPage?: number) { return this.all("tickets", page, perPage); }
  ticketsFind(id: number) { return this.find("tickets", id); }
  ticketsSearch(query: string, limit?: number) { return this.search("tickets", query, limit); }
  ticketsCreate(data: {
    title: string;
    group: string;
    customer: string;
    body: string;
    type?: string;
    priority_id?: number;
    state_id?: number;
    tags?: string;
  }) {
    const articleType = data.type ?? "note";
    // Workaround for zammad/zammad#4460: when an agent-token API call creates a
    // ticket whose first article is type=email without an explicit sender,
    // Zammad defaults sender=Agent and the "auto-reply to customer" trigger
    // fires with an empty `to:` recipient. Pinning sender=Customer mirrors the
    // upstream-recommended workaround — the article represents the inbound
    // email that opened the ticket.
    const article: Record<string, unknown> = {
      subject: data.title,
      body: data.body,
      type: articleType,
      internal: false,
    };
    if (articleType === "email") {
      article.sender = "Customer";
      article.from = data.customer;
    }
    return this.request<unknown>("POST", "/tickets", {
      title: data.title,
      group: data.group,
      customer_id: `guess:${data.customer}`,
      priority_id: data.priority_id ?? 2,
      state_id: data.state_id ?? 1,
      tags: data.tags,
      article,
    });
  }
  ticketsUpdate(id: number, data: unknown) { return this.update("tickets", id, data); }
  ticketsDestroy(id: number) { return this.destroy("tickets", id); }
  ticketsMerge(id: number, targetId: number) {
    return this.request<unknown>("PUT", `/ticket_merge/${id}/${targetId}`);
  }

  // ── Ticket Articles ─────────────────────────────────────

  ticketArticlesForTicket(ticketId: number) {
    return this.request<unknown[]>("GET", `/ticket_articles/by_ticket/${ticketId}`);
  }
  ticketArticlesFind(id: number) { return this.find("ticket_articles", id); }
  ticketArticlesCreate(data: {
    ticket_id: number;
    body: string;
    subject?: string;
    type?: string;
    internal?: boolean;
    to?: string;
    cc?: string;
  }) {
    const articleType = data.type ?? "note";
    const internal = data.internal ?? true;
    // Guard for zammad/zammad#4460: a non-internal email article without a
    // recipient causes Zammad to send an email with an empty `to:` header.
    // Require the caller to supply `to` when they're sending a public email.
    if (articleType === "email" && !internal && !data.to) {
      throw new Error(
        'add_article: "to" is required when type="email" and internal=false ' +
        '(see zammad/zammad#4460 — otherwise Zammad sends an email with an empty recipient).'
      );
    }
    const payload: Record<string, unknown> = {
      ticket_id: data.ticket_id,
      body: data.body,
      subject: data.subject,
      type: articleType,
      internal,
      sender: "Agent",
      content_type: "text/plain",
    };
    if (data.to) payload.to = data.to;
    if (data.cc) payload.cc = data.cc;
    return this.request<unknown>("POST", "/ticket_articles", payload);
  }

  // ── Ticket States / Priorities ──────────────────────────

  ticketStatesAll() { return this.all("ticket_states"); }
  ticketPrioritiesAll() { return this.all("ticket_priorities"); }

  // ── Tags ────────────────────────────────────────────────

  tagsForTicket(ticketId: number) {
    return this.request<unknown>("GET", `/tags?object=Ticket&o_id=${ticketId}`);
  }
  tagsAdd(ticketId: number, tag: string) {
    return this.request<unknown>("POST", "/tags/add", { object: "Ticket", o_id: ticketId, item: tag });
  }
  tagsRemove(ticketId: number, tag: string) {
    return this.request<unknown>("DELETE", "/tags/remove", { object: "Ticket", o_id: ticketId, item: tag });
  }
  tagListAll() { return this.all("tag_list"); }

  // ── Links ───────────────────────────────────────────────

  linksGet(ticketId: number) {
    return this.request<unknown>("GET", `/links?link_object=Ticket&link_object_value=${ticketId}`);
  }
  linksAdd(sourceId: number, targetId: number, linkType = "normal") {
    return this.request<unknown>("POST", "/links/add", {
      link_type: linkType,
      link_object_source: "Ticket", link_object_source_value: sourceId,
      link_object_target: "Ticket", link_object_target_value: targetId,
    });
  }
  linksRemove(sourceId: number, targetId: number, linkType = "normal") {
    return this.request<unknown>("DELETE", "/links/remove", {
      link_type: linkType,
      link_object_source: "Ticket", link_object_source_value: sourceId,
      link_object_target: "Ticket", link_object_target_value: targetId,
    });
  }

  // ── Online Notifications ────────────────────────────────

  notificationsAll(page?: number, perPage?: number) { return this.all("online_notifications", page, perPage); }
  notificationsFind(id: number) { return this.find("online_notifications", id); }
  notificationsMarkAllRead() { return this.request<unknown>("POST", "/online_notifications/mark_all_as_read"); }

  // ── Object Manager Attributes ───────────────────────────

  objectsAll() { return this.all("object_manager_attributes"); }
  objectsFind(id: number) { return this.find("object_manager_attributes", id); }

  // ── Knowledge Base ──────────────────────────────────────

  kbInit() { return this.request<unknown>("POST", "/knowledge_bases/init"); }

  async kbSearch(query: string): Promise<unknown> {
    // Zammad has no dedicated KB search endpoint.
    // Fetch all KB data via init, then filter answers client-side.
    const init = await this.request<Record<string, Record<string, unknown>>>("POST", "/knowledge_bases/init");
    const q = query.toLowerCase();

    const translations = init["KnowledgeBaseAnswerTranslation"] ?? {};
    const contents = init["KnowledgeBaseAnswerTranslationContent"] as Record<string, any> ?? {};
    const answers = init["KnowledgeBaseAnswer"] ?? {};
    const categoryTranslations = init["KnowledgeBaseCategoryTranslation"] ?? {};

    const results: unknown[] = [];
    for (const [id, t] of Object.entries(translations) as [string, any][]) {
      const title = (t.title ?? "").toLowerCase();
      const content = (contents[t.content_id]?.body ?? "").toLowerCase();
      if (title.includes(q) || content.includes(q)) {
        const answer = answers[t.answer_id] as any;
        const catTranslation = answer ? Object.values(categoryTranslations).find((ct: any) => ct.category_id === answer.category_id) as any : null;
        results.push({
          answer_id: t.answer_id,
          translation_id: parseInt(id),
          title: t.title,
          category: catTranslation?.title ?? null,
          published: !!answer?.published_at,
          body_preview: (contents[t.content_id]?.body ?? "").slice(0, 200),
        });
      }
    }
    return results.length ? results : { message: "No knowledge base articles matched the query.", query };
  }

  async kbAnswerFind(answerId: number) {
    // First get the answer metadata to find the translation ID
    const answer = await this.request<any>("GET", `/knowledge_bases/${this.kbId}/answers/${answerId}`);
    // Then re-fetch with content included
    const translationIds = answer?.assets?.KnowledgeBaseAnswer?.[answerId]?.translation_ids ?? [];
    if (translationIds.length > 0) {
      return this.request<unknown>("GET", `/knowledge_bases/${this.kbId}/answers/${answerId}?include_contents=${translationIds[0]}`);
    }
    return answer;
  }
  kbAnswerCreate(data: { category_id: number; title: string; body: string }) {
    return this.request<unknown>("POST", `/knowledge_bases/${this.kbId}/answers`, {
      category_id: data.category_id,
      translations_attributes: [{
        kb_locale_id: parseInt(this.localeId),
        title: data.title,
        content_attributes: { body: data.body },
      }],
    });
  }
  kbAnswerUpdate(answerId: number, data: { translation_id: number; title?: string; body?: string; category_id?: number }) {
    const attrs: Record<string, unknown> = { id: data.translation_id };
    if (data.title) attrs.title = data.title;
    if (data.body) attrs.content_attributes = { body: data.body };
    const payload: Record<string, unknown> = { translations_attributes: [attrs] };
    if (data.category_id) payload.category_id = data.category_id;
    return this.request<unknown>("PATCH", `/knowledge_bases/${this.kbId}/answers/${answerId}`, payload);
  }
  kbAnswerAddTranslation(answerId: number, data: { kb_locale_id: number; title: string; body: string; category_id: number }) {
    return this.request<unknown>("PATCH", `/knowledge_bases/${this.kbId}/answers/${answerId}`, {
      category_id: data.category_id,
      translations_attributes: [{
        kb_locale_id: data.kb_locale_id,
        title: data.title,
        content_attributes: { body: data.body },
      }],
    });
  }
  kbLocales() {
    return this.kbInit().then((init: any) => {
      const locales = init["KnowledgeBaseLocale"] ?? {};
      return Object.values(locales).map((l: any) => ({
        kb_locale_id: l.id,
        system_locale_id: l.system_locale_id,
        primary: l.primary,
      }));
    });
  }
  kbAnswerDestroy(answerId: number) {
    return this.request<unknown>("DELETE", `/knowledge_bases/${this.kbId}/answers/${answerId}`);
  }
  kbAnswerPublish(answerId: number) {
    return this.request<unknown>("POST", `/knowledge_bases/${this.kbId}/answers/${answerId}/publish`);
  }
  kbAnswerArchive(answerId: number) {
    return this.request<unknown>("POST", `/knowledge_bases/${this.kbId}/answers/${answerId}/archive`);
  }
  kbAnswerInternal(answerId: number) {
    return this.request<unknown>("POST", `/knowledge_bases/${this.kbId}/answers/${answerId}/internal`);
  }

  kbCategoryFind(categoryId: number) {
    return this.request<unknown>("GET", `/knowledge_bases/${this.kbId}/categories/${categoryId}`);
  }
  kbCategoryCreate(data: { title: string; icon?: string; parent_id?: number }) {
    return this.request<unknown>("POST", `/knowledge_bases/${this.kbId}/categories`, {
      category_icon: data.icon ?? "f115",
      parent_id: data.parent_id,
      translations_attributes: [{
        kb_locale_id: parseInt(this.localeId),
        title: data.title,
        content_attributes: { body: "" },
      }],
    });
  }
  kbCategoryUpdate(categoryId: number, data: { translation_id: number; title?: string; icon?: string; parent_id?: number }) {
    const payload: Record<string, unknown> = {};
    if (data.icon) payload.category_icon = data.icon;
    if (data.parent_id) payload.parent_id = data.parent_id;
    const attrs: Record<string, unknown> = { id: data.translation_id };
    if (data.title) attrs.title = data.title;
    payload.translations_attributes = [attrs];
    return this.request<unknown>("PATCH", `/knowledge_bases/${this.kbId}/categories/${categoryId}`, payload);
  }
  kbCategoryDestroy(categoryId: number) {
    return this.request<unknown>("DELETE", `/knowledge_bases/${this.kbId}/categories/${categoryId}`);
  }

  // ── Global search ───────────────────────────────────────

  globalSearch(query: string, limit = 10) {
    return this.request<unknown>("GET", `/search?query=${encodeURIComponent(query)}&limit=${limit}`);
  }
}
