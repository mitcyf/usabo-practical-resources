(() => {
  "use strict";

  const STORAGE_KEY = "usabo.ml.workspace.v1";
  const DEFAULT_TOOL = "dataset-explorer";
  const CLEAR_DATA_TOOL = "clear-data";
  const tools = new Set(["dataset-explorer", "regression-trainer", "regression-evaluator", CLEAR_DATA_TOOL]);
  const buttons = Array.from(document.querySelectorAll("[data-ml-tool]"));
  const workspace = document.querySelector("[data-ml-workspace]");
  if (!buttons.length) return;

  function storedId() {
    try {
      return window.localStorage.getItem(STORAGE_KEY) || "";
    } catch (err) {
      return "";
    }
  }

  function saveId(id) {
    if (id === CLEAR_DATA_TOOL) return;
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

  function clearSavedData(messageBox) {
    if (!window.confirm("Clear saved inputs and outputs for Machine Learning Tools?")) return;
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch (err) {
      // Storage may be unavailable; there is no saved ML state left in memory.
    }
    if (messageBox) {
      messageBox.textContent = "Saved data cleared.";
      messageBox.className = "message ok";
    }
  }

  function renderWorkspace(id) {
    if (!workspace) return;
    workspace.classList.toggle("blank-workspace", id !== CLEAR_DATA_TOOL);
    if (id !== CLEAR_DATA_TOOL) {
      workspace.textContent = "";
      return;
    }
    workspace.innerHTML = '<div class="buttons"><button type="button" data-clear-ml-data>Clear data</button></div><div class="message" data-clear-message role="status" aria-live="polite"></div>';
    const button = workspace.querySelector("[data-clear-ml-data]");
    const messageBox = workspace.querySelector("[data-clear-message]");
    if (button) button.addEventListener("click", () => clearSavedData(messageBox));
  }

  function render() {
    const id = activeId();
    saveId(id);
    buttons.forEach((button) => {
      const active = button.dataset.mlTool === id;
      button.classList.toggle("active", active);
      button.setAttribute("aria-current", active ? "page" : "false");
    });
    renderWorkspace(id);
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
