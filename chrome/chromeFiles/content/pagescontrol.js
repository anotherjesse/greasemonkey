/**
 * Implements the UI for the pages control.
 *
 * @constructor
 * @param {nsIDOMElement} ctlPages  An instance of the XUL element for the
 *   pages control.
 */
function PagesControl(ctlPages) {
  this.doc = ctlPages.ownerDocument;
  this.includesBox = new PagesBox(this.doc.getElementById("grpIncluded"));
  this.excludesBox = new PagesBox(this.doc.getElementById("grpExcluded"));
};

/**
 * Populate the includes and excludes for the given script.
 *
 * @param {Script} script  The script to populate from.
 */
PagesControl.prototype.populate = function(script) {
  this.includesBox.populate(script.includes);
  this.excludesBox.populate(script.excludes);
};

/**
 * Clear the includes and excludes box.
 */
PagesControl.prototype.clear = function() {
  this.includesBox.clear();
  this.excludesBox.clear();
};


/**
 * Implements UI for an individual include/exclude box in the pages control.
 *
 * @param {nsIDOMElement} grpBox  The DOM node for the pages box.
 */
function PagesBox(grpBox) {
  var buttons = grpBox.getElementsByTagName("button");
  var selectedPage = null;

  this.pages = null;
  this.doc = grpBox.ownerDocument;
  this.groupbox = grpBox;
  this.listbox = grpBox.getElementsByTagName("listbox")[0];
  this.btnAdd = buttons[0];
  this.btnEdit = buttons[1];
  this.btnRemove = buttons[2];

  GM_listen(this.listbox, "select", GM_hitch(this, "updatePagesBox"));
  GM_listen(this.btnAdd, "command", GM_hitch(this, "promptForNewPage"));
  GM_listen(this.btnEdit, "command", GM_hitch(this, "promptForEdit"));
  GM_listen(this.btnRemove, "command", GM_hitch(this, "remove"));
};

/**
 * Populate the box with a list of pages to be included/excluded.
 *
 * @param {Array<String>} pages  Pages to add.
 */
PagesBox.prototype.populate = function(pages) {
  this.clear();
  this.pages = pages;

  for (var i = 0, page = null; (page = this.pages[i]); i++) {
    this.addPage(page);
  }
};

/**
 * Clears the urls from the box.
 */
PagesBox.prototype.clear = function() {
  this.pages = null;

  while (this.listbox.hasChildNodes()) {
    this.listbox.removeChild(this.listbox.childNodes[0]);
  }
};

/**
 * Updates the enabled state of the edit/remove buttons based on what is
 * currently selected.
 */
PagesBox.prototype.updatePagesBox = function() {
  selectedPage = this.listbox.getSelectedItem(0);
  this.btnEdit.disabled = selectedPage == null;
  this.btnRemove.disabled = selectedPage == null;
};

/**
 * Prompt the user for a new page entry.
 */
PagesBox.prototype.promptForNewPage = function() {
  var gmManageBundle = this.doc.getElementById("gm-manage-bundle");
  var val = gmPrompt(
    gmManageBundle.getString("promptForNewPage.msg"), 
    gmManageBundle.getString("promptForNewPage.defVal"), 
    gmManageBundle.getString("promptForNewPage.title"));

  if (val && val != "") {
    this.addPage(val);
    this.pages.push(val);
    dirty = true;
  }
};

/**
 * Prompt the user to edit the selected page.
 */
PagesBox.prototype.promptForEdit = function() {
  var gmManageBundle = this.doc.getElementById("gm-manage-bundle");
  var val = gmPrompt(
    gmManageBundle.getString("promptForEdit.msg"), 
    this.listbox.selectedItem.label, 
    gmManageBundle.getString("promptForEdit.title"));

  if (val && val != "") {
    this.listbox.selectedItem.label = val;
    this.pages[this.listbox.selectedIndex] = val;

    dirty = true;
  }
};

/**
 * Remove the selected page.
 */
PagesBox.prototype.remove = function() {
  this.pages.splice(this.listbox.selectedIndex, 1);
  this.listbox.removeChild(this.listbox.getSelectedItem(0));

  // it's sorta wierd that the button stays focused when it is disabled because nothing is selected
  if (this.listbox.length == 0) {
    this.listbox.focus();
    dirty = true;
  }
};

/**
 * Helper to add a new page.
 *
 * @param {String} pageSpec  The pattern of pages to match.
 */
PagesBox.prototype.addPage = function(pageSpec) {
  var listitem = this.doc.createElement("listitem");
  listitem.setAttribute("label", pageSpec);
  this.listbox.appendChild(listitem);
};
