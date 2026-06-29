(() => {
  "use strict";

  const STORAGE_KEY = "usabo.ml.workspace.v1";
  const DEFAULT_TOOL = "dataset-explorer";
  const tools = new Set(["dataset-explorer", "regression-trainer", "regression-evaluator"]);
  const buttons = Array.from(document.querySelectorAll("[data-ml-tool]"));
  if (!buttons.length) return;

  function storedId() {
    try {
      return window.localStorage.getItem(STORAGE_KEY) || "";
    } catch (err) {
      return "";
    }
  }

  function saveId(id) {
    try {
      window.localStorage.setItem(STORAGE_KEY, id);
    } catch (err) {
      // Persistence is optional; the page still works without storage.
    }
  }

  function activeId() {
    const id = window.location.hash.replace(/^#/, "");
    if (tools.has(id)) return id;
    const saved = storedId();
    return tools.has(saved) ? saved : DEFAULT_TOOL;
  }

  function render() {
    const id = activeId();
    saveId(id);
    buttons.forEach((button) => {
      const active = button.dataset.mlTool === id;
      button.classList.toggle("active", active);
      button.setAttribute("aria-current", active ? "page" : "false");
    });
  }

  buttons.forEach((button) => {
    button.addEventListener("click", () => {
      saveId(button.dataset.mlTool);
      history.replaceState(null, "", "#" + button.dataset.mlTool);
      render();
    });
  });

  window.addEventListener("hashchange", render);
  render();
})();
