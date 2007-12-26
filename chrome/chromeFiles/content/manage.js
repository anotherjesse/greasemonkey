/**
 * Implements the UI for the manage dialog.
 *
 * @constructor
 * @param {nsIDOMWindow} win  An instance of the manage dialog.
 */
function ManageWindow(win) {
  this.win = win;
  this.doc = win.document;
  this.config = new Config(getScriptFile("config.xml"));
  this.uninstallList = [];

  GM_listen(this.win, "load", GM_hitch(this, "chromeLoad"));
};

/**
 * Called when the window has finished loading. Initialize all the controls.
 */
ManageWindow.prototype.chromeLoad = function() {
  this.config.load();
  this.loadControls();
  
  if (!this.config.scripts.length == 0) {
    this.populateChooser();
    this.chooseScript(0);
  }
};

/**
 * Helper to load controls and init events.
 */
ManageWindow.prototype.loadControls = function() {
  this.listbox = this.doc.getElementById("lstScripts");
  this.header = this.doc.getElementById("ctlHeader");
  this.description = this.doc.getElementById("ctlDescription");
  this.btnEdit = this.doc.getElementById("btnEdit");
  this.btnUninstall = this.doc.getElementById("btnUninstall");
  this.pagesControl = new PagesControl(this.doc.getElementById("pages-control"));
  this.chkEnabled = this.doc.getElementById("chkEnabled");

  GM_listen(this.listbox, "select", GM_hitch(this, "updateDetails"));
  GM_listen(this.btnEdit, "command", GM_hitch(this, "handleEditButton"));
  GM_listen(this.btnUninstall, "command", GM_hitch(this, "handleEditButton"));
  GM_listen(this.chkEnabled, "command", GM_hitch(this, "handleChkEnabledChanged"));
};

/**
 * Called when the enabled checkbox changes.
 */
ManageWindow.prototype.handleChkEnabledChanged = function() {
  if (this.selectedScript) {
    this.selectedScript.enabled = this.chkEnabled.checked;
    if (this.selectedScript.enabled) {
     this.listbox.selectedItem.style.color = '';
    } else {
     this.listbox.selectedItem.style.color = 'gray';
    }
  }
};

/**
 * Helper to update the details panel when the selected script changes.
 */
ManageWindow.prototype.updateDetails = function() {
  if (this.listbox.selectedCount == 0) {
    this.selectedScript = null;
    this.header.textContent = " ";
    this.description.textContent = " ";
    this.chkEnabled.checked = true;
    this.pagesControl.clear();
    this.doc.documentElement.getButton("accept").disabled = false;
  }
  else {
    this.selectedScript = this.listbox.getSelectedItem(0).script;

    // make sure one word isn't too long to fit ... a too-long word
    // will bump the interface out wider than the window
    var wordLen = 50;
    var desc = this.selectedScript.description.split(/\s+/);
    for (var i = 0; i < desc.length; i++) {
      if (desc[i].length>wordLen) {
        for (var j=desc[i].length; j>0; j-=wordLen) {
          desc[i]=desc[i].substr(0,j)+'\u200B'+desc[i].substr(j);
        }
      }
    }
    desc=desc.join(' ');

    this.header.textContent = this.selectedScript.name;
    this.description.textContent = desc;
    this.chkEnabled.checked = this.selectedScript.enabled;
    this.pagesControl.populate(this.selectedScript);
  }
};

/**
 * Called when the edit button is clicked. Open the selected script in an
 * editor.
 */
ManageWindow.prototype.handleEditButton = function() {
  openInEditor(
    getScriptFile(this.selectedScript.filename),
    this.doc.getElementById("gm-manage-bundle").getString("editor.prompt"));
};

/**
 * Called when the uninstall button is clicked. Remove the script from the
 * config and select the next script.
 */
ManageWindow.prototype.handleUninstallButton = function() {
  this.uninstallList.push(this.selectedScript);
  this.listbox.removeChild(
    this.listbox.childNodes[this.listbox.selectedIndex]);

  if (this.listbox.childNodes.length > 0) {
    this.chooseScript(
      Math.max(
        Math.min(
          this.listbox.selectedIndex, 
          this.listbox.childNodes.length - 1), 0));
  }
};

/**
 * Helper to populate the listbox with the installed scripts.
 */
ManageWindow.prototype.populateChooser = function() {
  for (var i = 0, script = null; (script = this.config.scripts[i]); i++) {
    var listitem = this.doc.createElement("listitem");

    listitem.setAttribute("label", script.name);
    listitem.setAttribute("crop", "end");
    listitem.script = script;
    if (!script.enabled) {
      listitem.style.color = 'gray';
    }
    this.listbox.appendChild(listitem);
  }
}

/**
 * Helper to select a specific script.
 *
 * @param {Number} index  The index of the script in the list.
 */
ManageWindow.prototype.chooseScript = function(index) {
  this.listbox.selectedIndex = index;
  this.listbox.focus();
};

/**
 * Called when the OK button is clicked. Commit all the changes to the config.
 */
ManageWindow.prototype.handleOkButton = function() {
  for (var i = 0, script = null; (script = this.uninstallList[i]); i++) {
    var idx = this.config.find(script.namespace, script.name);
    this.config.scripts.splice(idx, 1);
  }
  this.config.save();

  var chkUninstallPrefs = this.doc.getElementById('chkUninstallPrefs');
  for (var i = 0, script = null; (script = this.uninstallList[i]); i++) {
    getScriptFile(script.filename).remove(false);
    if (this.chkUninstallPrefs.checked) {
      // Remove saved preferences
      var scriptPrefRoot = ["scriptvals.",
                            script.namespace,
                            "/",
                            script.name,
                            "."].join("");
      GM_prefRoot.remove(scriptPrefRoot);
    }
  }
  return true;
};
