var gPagesControl = {
  excludes: [],
  includes: [],
  _tree: null,
  _script: null,

  setScript: function(script) {
    if (this._script) {
      this._script.removeObserver(this);
    }

    this._script = script;

    if (this._script == null) {
      this.excludes = [];
      this.includes = [];
    } else {
      this.excludes = this._script.excludes;
      this.includes = this._script.includes;
      this._script.addObserver(this);
    }

    var url = document.getElementById("url");
    url.value = "http://" + url.getAttribute("defaultHost") + "/*";

    var win = Components.classes["@mozilla.org/appshell/window-mediator;1"]
                        .getService(Components.interfaces.nsIWindowMediator)
                        .getMostRecentWindow("navigator:browser");
    if (win) {
      var location = win.content.location;

      if (GM_isGreasemonkeyable(location.href)) {
        url.value = location.protocol + "//" + location.hostname + "/*";
      }
    }

    this._tree = document.getElementById("pagesTree");
    this._tree.view = treeView;
    this.onUrlInput();
    this.onPageSelect();
  },

  notifyEvent: function(script, event, data) {
    if (script != this._script) return;
    switch (event) {
    case "edit-include-add":
      this.includes.push(data);
      this._tree.treeBoxObject.rowCountChanged(this.excludes.length + this.includes.length - 1, 1);
      break;
    case "edit-include-remove":
      this.includes.splice(data, 1);
      this._tree.treeBoxObject.rowCountChanged(this.excludes.length + data, -1);
      break;
    case "edit-exclude-add":
      this.excludes.push(data);
      this._tree.treeBoxObject.rowCountChanged(this.excludes.length - 1, 1);
      break;
    case "edit-exclude-remove":
      this.excludes.splice(data, 1);
      this._tree.treeBoxObject.rowCountChanged(data, -1);
      break;
    case "remove":
      window.close();
      break;
    }
    this.onPageSelect();
  },

  onUrlInput: function() {
    document.getElementById("btnExclude").disabled =
    document.getElementById("btnInclude").disabled =
      !document.getElementById("url").value || !this._script;
  },

  onUrlKeypress: function(event) {
    if (event.keyCode == KeyEvent.DOM_VK_RETURN) {
      document.getElementById("btnInclude").click();
      return false;
    }
    return true;
  },

  addPage: function(type) {
    var url = document.getElementById("url").value;
    switch (type) {
    case "exclude":
      this._script.addExclude(url);
      break;
    case "include":
      this._script.addInclude(url);
      break;
    };
  },

  removeSelectedPages: function() {
    var selection = this._tree.view.selection;
    selection.selectEventsSuppressed = true;
    
    var rc = selection.getRangeCount();
    var url = "";
    for (var i = rc - 1; i >= 0; i--) {
      var min = {}; var max = {};
      selection.getRangeAt(i, min, max);
      for (var rowIndex = max.value; rowIndex >= min.value; rowIndex--) {
        var page = this.getPageFromRowIndex(rowIndex);
        switch (page.type) {
        case "exclude":
          url = page.value;
          this._script.removeExcludeAt(page.index);
          break;
        case "include":
          url = page.value;
          this._script.removeIncludeAt(page.index);
          break;
        }
      }
    }
    selection.selectEventsSuppressed = false;
    if (url)
      document.getElementById("url").value = url;
    this.onUrlInput();
  },

  getPageFromRowIndex: function(rowIndex) {
    if (rowIndex < this.excludes.length) {
      var page = { type: "exclude", index: rowIndex };
      page.value = this.excludes[page.index];
    } else {
      var page = { type: "include", index: rowIndex - this.excludes.length };
      page.value = this.includes[page.index];
    }
    return page;
  },

  get pageCount() {
    return this.includes.length + this.excludes.length; 
  },

  onPageSelect: function() {
    document.getElementById("removePage")
            .disabled = this._tree.view.selection.count == 0;
  },

  onPageKeyPress: function(event) {
    if (event.keyCode == KeyEvent.DOM_VK_DELETE)
      this.removeSelectedPages();
  },
};

var treeView = {
  get rowCount() {
    return gPagesControl.pageCount;
  },

  getCellText: function (rowIndex, column) {
    var page = gPagesControl.getPageFromRowIndex(rowIndex);
    switch (column.id) {
    case "pageCol": return page.value;
    case "statusCol": return document.getElementById("statusCol")
                                      .getAttribute("status-" + page.type);
    default: return "";
    }
  },

  isSeparator: function(aIndex) { return false; },
  isSorted: function() { return false; },
  isContainer: function(aIndex) { return false; },
  setTree: function(aTree) {},
  getImageSrc: function(aRow, aColumn) {},
  getProgressMode: function(aRow, aColumn) {},
  getCellValue: function(aRow, aColumn) {},
  cycleHeader: function(column) {},
  getRowProperties: function(row, prop) {},
  getColumnProperties: function(column, prop) {},
  getCellProperties: function(row, column, prop) {}
};

function initWithScript(script) {
  gPagesControl.setScript(script);
}

function onLoad() {
  var script = window.arguments[0];
  gPagesControl.setScript(script);
}

function onUnload() {
  gPagesControl.setScript(null);
}
