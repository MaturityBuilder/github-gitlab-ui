(function () {
  const GL = (globalThis.GitLabLook = globalThis.GitLabLook || {});

  function pagePath(doc) {
    return GL.pagePath ? GL.pagePath(doc) : (doc.body && doc.body.dataset.glPath) || "";
  }

  function isConversation(path) {
    return /^\/[^/]+\/[^/]+\/pull\/\d+\/?$/.test(path);
  }

  function isPull(path) {
    return /^\/[^/]+\/[^/]+\/pull\/\d+/.test(path);
  }

  function stamp(items, key) {
    let max = -1;
    items.forEach((item) => {
      const current = Number(item.dataset[key]);
      if (!Number.isNaN(current)) max = Math.max(max, current);
    });
    items.forEach((item) => {
      if (item.dataset[key] === undefined) {
        max += 1;
        item.dataset[key] = String(max);
      }
    });
  }

  function reorder(items, order, key) {
    if (items.length < 2) return;
    const parent = items[0].parentElement;
    if (!parent || items.some((item) => item.parentElement !== parent)) return;
    const sorted = items.slice().sort((a, b) => {
      const delta = Number(a.dataset[key]) - Number(b.dataset[key]);
      return order === "desc" ? -delta : delta;
    });
    const anchor = parent.ownerDocument.createElement("span");
    anchor.hidden = true;
    parent.insertBefore(anchor, items[0]);
    sorted.forEach((item) => parent.insertBefore(item, anchor));
    anchor.remove();
  }

  function timelineItems(discussion) {
    return [...discussion.querySelectorAll(".js-timeline-item")].filter(
      (item) => !item.parentElement.closest(".js-timeline-item")
    );
  }

  function replyItems(holder) {
    return [...holder.children].filter((node) =>
      node.matches(".timeline-comment-group, .timeline-comment, .review-comment, [id^='discussion_r']")
    );
  }

  function applyCommentOrder(doc, order) {
    const direction = order === "desc" ? "desc" : "asc";
    const path = pagePath(doc);
    if (!isPull(path)) {
      removeCommentControl(doc);
      return;
    }
    doc.querySelectorAll(".js-discussion").forEach((discussion) => {
      const items = timelineItems(discussion);
      stamp(items, "glIndex");
      if (discussion.dataset.glOrder !== direction || items.some((item) => item.dataset.glPlaced !== direction)) {
        reorder(items, direction, "glIndex");
        items.forEach((item) => {
          item.dataset.glPlaced = direction;
        });
        discussion.dataset.glOrder = direction;
      }
    });
    doc.querySelectorAll(".js-comments-holder, .js-inline-comments-container").forEach((holder) => {
      const replies = replyItems(holder);
      stamp(replies, "glReplyIndex");
      if (holder.dataset.glOrder !== direction || replies.some((reply) => reply.dataset.glPlaced !== direction)) {
        reorder(replies, direction, "glReplyIndex");
        replies.forEach((reply) => {
          reply.dataset.glPlaced = direction;
        });
        holder.dataset.glOrder = direction;
      }
    });
    if (isConversation(path)) mountCommentControl(doc, direction);
    else removeCommentControl(doc);
  }

  function removeCommentControl(doc) {
    const control = doc.getElementById("gl-comment-order");
    if (control) control.remove();
  }

  function mountCommentControl(doc, order) {
    const discussion = doc.querySelector(".js-discussion");
    if (!discussion) return;
    let control = doc.getElementById("gl-comment-order");
    if (!control) {
      control = doc.createElement("div");
      control.id = "gl-comment-order";
      control.className = "gl-comment-order";
      control.setAttribute("role", "group");
      control.setAttribute("aria-label", "Comment order");
      ["asc", "desc"].forEach((value) => {
        const button = doc.createElement("button");
        button.type = "button";
        button.dataset.order = value;
        button.textContent = value === "asc" ? "Oldest" : "Newest";
        button.addEventListener("click", () => {
          const next = button.dataset.order;
          if (GL.saveCommentOrder) GL.saveCommentOrder(next);
          applyCommentOrder(doc, next);
          syncPressed(control, next);
        });
        control.appendChild(button);
      });
      const heading = [...doc.querySelectorAll("h1, h2")].find((node) => /conversation/i.test(node.textContent || ""));
      if (heading) heading.insertAdjacentElement("afterend", control);
      else discussion.prepend(control);
    }
    syncPressed(control, order);
  }

  function syncPressed(control, order) {
    control.querySelectorAll("button").forEach((button) => {
      button.setAttribute("aria-pressed", button.dataset.order === order ? "true" : "false");
    });
  }

  function restoreCommentOrder(doc) {
    applyCommentOrder(doc, "asc");
    removeCommentControl(doc);
  }

  GL.applyCommentOrder = applyCommentOrder;
  GL.restoreCommentOrder = restoreCommentOrder;
  GL.isConversation = isConversation;
})();
