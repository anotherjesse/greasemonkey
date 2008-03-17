var config = GM_getConfig();
var gScriptsView = null;

function Startup() {
  gScriptsView = document.getElementById("scriptsView");

  updateGlobalEnabledButton();
  GM_prefRoot.watch("enabled", updateGlobalEnabledButton);

  populateChooser();
  config.addObserver(observer);

  restoreSelection();

  gScriptsView.controllers.appendController(gScriptsViewController);
  gScriptsViewController.onCommandUpdate();

  gScriptsView.focus();
}

function Shutdown() {
  config.removeObserver(observer);

  GM_prefRoot.unwatch("enabled", updateGlobalEnabledButton);
}

function restoreSelection() {
  var selected = null;
  var id = gScriptsView.getAttribute("selected-script-id");
  var nodes = gScriptsView.children;
  if (id) {
    for (var i = 0, node; node = nodes[i]; i++) {
      if (node.script.id == id) {
        selected = node;
        break;
      }
    }
  }
  gScriptsView.selectedItem = selected || nodes[0];
  registerSelection();
}

function registerSelection() {
  if (gScriptsView.selectedItem)
    gScriptsView.setAttribute("selected-script-id", gScriptsView.selectedItem.script.id);
}

function updateGlobalEnabledButton() {
  document.getElementById("commandBarBottom")
    .setAttribute("gm-enabled", GM_prefRoot.getValue("enabled", true));
}

function onViewDoubleClick(aEvent) {
  if (aEvent.button == 0 && gScriptsView.selectedItem)
    gScriptsViewController.doCommand("cmd_pages");
}

var gScriptsViewController = {
  supportsCommand: function (aCommand) {
    var commandNode = document.getElementById(aCommand);
    return commandNode && (commandNode.parentNode == document.getElementById("scriptsCommands"));
  },

  isCommandEnabled: function (aCommand) {
    var selectedItem = gScriptsView.selectedItem;

    if (!selectedItem) return false;

    switch (aCommand) {
    case "cmd_edit":
    case "cmd_pages":
    case "cmd_uninstall":
      return true;
    case "cmd_disable":
      return selectedItem.script.enabled;
    case "cmd_enable":
      return !selectedItem.script.enabled;
    case "cmd_moveup":
      return selectedItem != gScriptsView.children[0];
    case "cmd_movedown":
      return selectedItem != gScriptsView.children[gScriptsView.children.length-1];
    default:
      return false;
    }
  },

  doCommand: function (aCommand) {
    if (this.isCommandEnabled(aCommand))
      this.commands[aCommand](gScriptsView.selectedItem);
  },

  onCommandUpdate: function () {
    var scriptsCommands = document.getElementById("scriptsCommands");
    for (var i = 0; i < scriptsCommands.childNodes.length; ++i)
      this.updateCommand(scriptsCommands.childNodes[i]);
  },

  updateCommand: function (command) {
    if (this.isCommandEnabled(command.id))
      command.removeAttribute("disabled");
    else
      command.setAttribute("disabled", "true");
  },

  commands: {
    cmd_edit: function (aSelectedItem) {
      openInEditor(aSelectedItem.script);
      gScriptsView.focus();
    },

    cmd_pages: function (aSelectedItem) {
      var win = Components.classes["@mozilla.org/appshell/window-mediator;1"]
                          .getService(Components.interfaces.nsIWindowMediator)
                          .getMostRecentWindow("Greasemonkey:Pages");
      if (win) {
        win.initWithScript(aSelectedItem.script);
        win.focus();
      } else {
        var parentWindow = (!window.opener || window.opener.closed) ?
          window : window.opener;
        parentWindow.openDialog("chrome://greasemonkey/content/pages-overlay.xul",
          "_blank", "resizable,dialog=no,centerscreen", aSelectedItem.script);
      }
      gScriptsView.focus();
    },

    cmd_uninstall: function (aSelectedItem) {
      var bundle = Components
        .classes["@mozilla.org/intl/stringbundle;1"]
        .getService(Components.interfaces.nsIStringBundleService)
        .createBundle("chrome://greasemonkey/locale/uninstall.properties");

      var promptService = Components
        .classes["@mozilla.org/embedcomp/prompt-service;1"]
        .getService(Components.interfaces.nsIPromptService);

      var hasPrefs = GM_prefRoot.existsBranch(aSelectedItem.script.prefBranch);
      var buttonChoice = promptService.confirmEx(
        window,
        bundle.GetStringFromName("dialogTitle"),
        bundle.formatStringFromName(hasPrefs ? "textWithPrefs" :
          "textWithoutPrefs", [aSelectedItem.script.name], 1),
        promptService.BUTTON_POS_0_DEFAULT +
        promptService.BUTTON_TITLE_IS_STRING * (
          promptService.BUTTON_POS_0 + promptService.BUTTON_POS_1 +
          (hasPrefs ? promptService.BUTTON_POS_2 : 0)
        ),
        bundle.GetStringFromName("removeScript"),
        bundle.GetStringFromName("cancel"),
        bundle.GetStringFromName("removeScriptAndPrefs"),
        null, {}
      );

      if (buttonChoice == 2)
        GM_prefRoot.remove(aSelectedItem.script.prefBranch);

      if (buttonChoice != 1)
        config.uninstall(aSelectedItem.script);

      gScriptsView.focus();
    },

    cmd_disable: function (aSelectedItem) {
      aSelectedItem.script.enabled = false;
      gScriptsView.focus();
    },

    cmd_enable: function (aSelectedItem) {
      aSelectedItem.script.enabled = true;
      gScriptsView.focus();
    },

    cmd_moveup: function (aSelectedItem) {
      config.move(aSelectedItem.script, -1);
      gScriptsView.focus();
    },

    cmd_movedown: function (aSelectedItem) {
      config.move(aSelectedItem.script, 1);
      gScriptsView.focus();
    }
  }
};

function populateChooser() {
  config.scripts.forEach(createScriptNode);
}

function createScriptNode(script) {
    var node = document.createElement("richlistitem");
    node.setAttribute("name", script.name);
    node.setAttribute("description", script.description);
    node.setAttribute("isDisabled", !script.enabled);
    node.script = script;
    gScriptsView.appendChild(node);
}

function getNodeForScript(script) {
  for (var i = 0, nodes = gScriptsView.children, node; node = nodes[i]; i++)
    if (node.script == script)
      return node;

  throw new Error("Node not found");
}

var observer = {
  notifyEvent: function(script, event, data) {
    var node = getNodeForScript(script);
    switch (event) {
    case "edit-enabled":
      node.setAttribute("isDisabled", !script.enabled);
      gScriptsViewController.onCommandUpdate();
      break;
    case "install":
      createScriptNode(script);
      break;
    case "uninstall":
      gScriptsView.removeChild(node);
      break;
    case "move":
      gScriptsView.removeChild(node);
      if (data == gScriptsView.children.length)
        gScriptsView.appendChild(node);
      else
        gScriptsView.insertBefore(node, gScriptsView.children[data]);
      gScriptsViewController.onCommandUpdate();
      break;
    }
  }
}

function onScriptContextMenuShowing() {
  if (!gScriptsView.selectedItem) return false;
  var enabled = gScriptsView.selectedItem.script.enabled;
  document.getElementById("contextEnable").hidden = enabled;
  document.getElementById("contextDisable").hidden = !enabled;
}

// allow reordering scripts with drag-and-drop
var dndObserver = {
  draggedScript: null,

  getSupportedFlavours: function () {
    var flavours = new FlavourSet();
    flavours.appendFlavour("gm-user-script");
    return flavours;
  },

  onDragStart: function (event, transferData, action) {
    if ("richlistitem" != event.target.tagName) return false;

    this.draggedScript = event.target.script;
    transferData.data = new TransferData();
    transferData.data.addDataForFlavour("gm-user-script", "gm-reorder-script");

    return true;
  },

  onDragOver: function (event, flavour, session) {
    if (gScriptsView == event.target.parentNode)
      event.target.setAttribute("droptarget", true);
  },

  onDragExit: function(event, session) {
    if (gScriptsView == event.target.parentNode)
      event.target.removeAttribute("droptarget");
  },

  onDrop: function (event, dropdata, session) {
    if (gScriptsView == event.target.parentNode &&
      dropdata.data == "gm-reorder-script") {
      var source = this.draggedScript;
      var target = event.target.script;
      if (source && target) config.move(source, target);
    }
  }
};