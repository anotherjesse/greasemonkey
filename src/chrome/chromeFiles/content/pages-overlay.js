window.addEventListener("load", function(ev) {
  var gmManageBundle = document.getElementById("gm-manage-bundle");
  var defaultSite = gmManageBundle.getString("promptForNewPage.defVal");
  document.getElementById("locationBox").value = GM_getCurrentSite() || defaultSite;
  gPagesControl.onLocationInput();
}, false);

window.addEventListener("unload", function(ev) {
  gPagesControl.clear(); // Don't leak observers
}, false);

var gPagesControl = {
  notifyEvent: function(script, event, data) {
    switch (event) {
    case "edit-include-add":
      this.includes.push(data);
      this.treeView.treebox.rowCountChanged(this.getRowFromPage('include', this.includes.length - 1), 1);
      break;
    case "edit-include-remove":
      this.includes.splice(data, 1);
      this.treeView.treebox.rowCountChanged(this.getRowFromPage('include', data), -1);
      break;
    case "edit-exclude-add":
      this.excludes.push(data);
      this.treeView.treebox.rowCountChanged(this.getRowFromPage('exclude', this.excludes.length - 1), 1);
      break;
    case "edit-exclude-remove":
      this.excludes.splice(data, 1);
      this.treeView.treebox.rowCountChanged(this.getRowFromPage('exclude', data), -1);
      break;
    }
  },

  script: null,

  populate: function(script) {
    this.clear();
    this.includes = script.includes;
    this.excludes = script.excludes;
    this.script = script;
    this.script.addObserver(this);

    document.getElementById("pagesTree").view = this.treeView;
    this.onTreeSelect();
  },

  clear: function() {
    if (this.script == null) return;
    this.script.removeObserver(this);
    this.script = null;
  },

  onLocationInput: function() {
    document.getElementById("btnExclude").disabled =
    document.getElementById("btnInclude").disabled =
    !GM_isGreasemonkeyable(document.getElementById("locationBox").value);
  },

  onTreeSelect: function() {
    document.getElementById("btnRemove").disabled =
    !this.treeView.selection.getRangeCount();
  },

  addPage: function(type) {
    var val = document.getElementById("locationBox").value;
    if(type == "include")
      this.script.addInclude(val);
    else
      this.script.addExclude(val);
  },

  removeSelectedPages: function() {
    var start = {};
    var end = {};
    var numRanges = this.treeView.selection.getRangeCount();

    // Loop backwards to not mess up indexes while removing
    for (var t = numRanges - 1; t >= 0; t--) {
      this.treeView.selection.getRangeAt(t, start, end);
      for (var v = end.value; v >= start.value; v--) {
        // remove the page
        var page = this.getPageFromRow(v);
        switch (page.type) {
        case "include": this.script.removeIncludeAt(page.index); break;
        case "exclude": this.script.removeExcludeAt(page.index); break;
        }
        // allow user to edit the page and then re-add
        document.getElementById("locationBox").value = page.value;
      }
    }
  },

  getPageFromRow: function(row) {
    if (row < this.excludes.length)
      return {type: "exclude", index: row, value: this.excludes[row]};
    else
      return {type: "include", index: row - this.excludes.length,
              value: this.includes[row - this.excludes.length]};
  },

  getRowFromPage: function(type, index) {
    switch (type) {
    case 'include': return this.excludes.length + index;
    case 'exclude': return index;
    default: throw new Error('Unknown page type');
    }
  },

  treeView: {
    get rowCount() {
      return gPagesControl.includes.length + gPagesControl.excludes.length;
    },

    getCellText: function(row, column) {
      if (column.id == "colStatus")
        return gPagesControl.getPageFromRow(row).type;
      else
        return gPagesControl.getPageFromRow(row).value;
    },

    setTree: function(treebox){ this.treebox = treebox; },
    isContainer: function(row){ return false; },
    isSeparator: function(row){ return false; },
    isSorted: function(){ return false; },
    getLevel: function(row){ return 0; },
    getImageSrc: function(row,col){ return null; },
    getRowProperties: function(row,props){},
    getCellProperties: function(row,col,props){},
    getColumnProperties: function(colid,col,props){}
  }
}
