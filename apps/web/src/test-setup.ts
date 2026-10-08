import "@testing-library/jest-dom/vitest";

// jsdom has no modal dialog support: stub it so open/close toggle the attribute.
HTMLDialogElement.prototype.showModal = function showModal() {
  this.setAttribute("open", "");
};
HTMLDialogElement.prototype.close = function close() {
  this.removeAttribute("open");
  this.dispatchEvent(new Event("close"));
};
