// this file is the JavaScript backing for the UI wrangling which happens in
// browser.xul. It also initializes the Greasemonkey singleton which contains
// all the main injection logic, though that should probably be a proper XPCOM
// service and wouldn't need to be initialized in that case.

/* SVC (FROM XPCOM) */

const CID = Components.ID("{77bf3650-1cd6-11da-8cd6-0800200c9a66}");

//const Cc = Components.classes;
//const Ci = Components.interfaces;

const appSvc = Cc["@mozilla.org/appshell/appShellService;1"].getService(Ci.nsIAppShellService);

function alert(msg) {
  Cc["@mozilla.org/embedcomp/prompt-service;1"]
    .getService(Ci.nsIPromptService)
    .alert(null, "Greasemonkey alert", msg);
};

// Examines the stack to determine if an API should be callable.
function GM_apiLeakCheck(apiName) {
  var stack = Components.stack;

  do {
    // Valid stack frames for GM api calls are: native and js when coming from
    // chrome:// URLs and the greasemonkey.js component's file:// URL.
    if (2 == stack.language) {
      if ('chrome' != stack.filename.substr(0, 6) ) {
        GM_logError(new Error("Greasemonkey access violation: unsafeWindow " +
                    "cannot call " + apiName + "."));
        return false;
      }
    }
    
    stack = stack.caller;
  } while (stack);
        
  return true;
}; 

var GM_XPI_SVC = {

  domContentLoaded: function(wrappedContentWin, chromeWin) {
    var unsafeWin = wrappedContentWin.wrappedJSObject;
    var unsafeLoc = new XPCNativeWrapper(unsafeWin, "location").location;
    var href = new XPCNativeWrapper(unsafeLoc, "href").href;
    var scripts = this.initScripts(href);

    if (scripts.length > 0) {
      this.injectScripts(scripts, href, unsafeWin, chromeWin);
    }

  },

  initScripts: function(url) {
    var config = {'scripts':XPI_SCRIPTS};
    var scripts = [];

    outer:
    for (var i = 0; i < config.scripts.length; i++) {
      var script = config.scripts[i];
      if (script.enabled) {
        for (var j = 0; j < script.includes.length; j++) {
          var pattern = convert2RegExp(script.includes[j]);

          if (pattern.test(url)) {
            for (var k = 0; k < script.excludes.length; k++) {
              pattern = convert2RegExp(script.excludes[k]);

              if (pattern.test(url)) {
                continue outer;
              }
            }

            scripts.push(script);

            continue outer;
          }
        }
      }
    }
    return scripts;
  },

  injectScripts: function(scripts, url, unsafeContentWin, chromeWin) {
    var sandbox;
    var script;
    var logger;
    var console;
    var storage;
    var xmlhttpRequester;
    var resources;
    var safeWin = new XPCNativeWrapper(unsafeContentWin);
    var safeDoc = safeWin.document;

    // detect and grab reference to firebug console and context, if it exists
    var firebugConsole = this.getFirebugConsole(unsafeContentWin, chromeWin);

    for (var i = 0; script = scripts[i]; i++) {
      sandbox = new Components.utils.Sandbox(safeWin);

      logger = new GM_ScriptLogger(script);

      console = firebugConsole ? firebugConsole : new GM_console(script);

      storage = new GM_ScriptStorage(script);
      xmlhttpRequester = new GM_xmlhttpRequester(unsafeContentWin,
                                                 appSvc.hiddenDOMWindow);
      resources = new GM_Resources(script);

      sandbox.window = safeWin;
      sandbox.document = sandbox.window.document;
      sandbox.unsafeWindow = unsafeContentWin;

      // hack XPathResult since that is so commonly used
      sandbox.XPathResult = Ci.nsIDOMXPathResult;

      // add our own APIs
      sandbox.GM_addStyle = function(css) { GM_addStyle(safeDoc, css) };
      sandbox.GM_log = GM_hitch(logger, "log");
      sandbox.console = console;
      sandbox.GM_setValue = GM_hitch(storage, "setValue");
      sandbox.GM_getValue = GM_hitch(storage, "getValue");
      sandbox.GM_getResourceURL = GM_hitch(resources, "getResourceURL");
      sandbox.GM_getResourceText = GM_hitch(resources, "getResourceText");
      sandbox.GM_openInTab = GM_hitch(this, "openInTab", unsafeContentWin);
      sandbox.GM_xmlhttpRequest = GM_hitch(xmlhttpRequester,
                                           "contentStartRequest");
      sandbox.GM_registerMenuCommand = GM_hitch(this,
                                                "registerMenuCommand",
                                                unsafeContentWin);

      sandbox.__proto__ = safeWin;

      var ioService=Components.classes["@mozilla.org/network/io-service;1"].getService(Components.interfaces.nsIIOService);
      script.uriObj = ioService.newURI(script.uri, null, null);

      var contents = getContents(script.uriObj)

      var requires = [];
      var offsets = [];
      var offset = 0;

      script.requires.forEach(function(req){
        var uri = getDependencyFileURI(script, req);
        var contents = getContents(uri);
        var lineCount = contents.split("\n").length;
        requires.push(getContents(uri));
        offset += lineCount;
        offsets.push(offset);
      })
      script.offsets = offsets;

      var scriptSrc = "(function(){\n" +
                         requires.join("\n") +
                         "\n" +
                         contents +
                         "\n})()";
      this.evalInSandbox(scriptSrc,
                         url,
                         sandbox,
                         script);
    }
  },

  registerMenuCommand: function(unsafeContentWin, commandName, commandFunc,
                                accelKey, accelModifiers, accessKey) {
    if (!GM_apiLeakCheck("GM_registerMenuCommand")) {
      return;
    }

    var command = {name: commandName,
                   accelKey: accelKey,
                   accelModifiers: accelModifiers,
                   accessKey: accessKey,
                   doCommand: commandFunc,
                   window: unsafeContentWin };

    for (var i = 0; i < this.browserWindows.length; i++) {
      this.browserWindows[i].registerMenuCommand(command);
    }
  },

  openInTab: function(unsafeContentWin, url) {
    if (!GM_apiLeakCheck("GM_openInTab")) {
      return;
    }

    var unsafeTop = new XPCNativeWrapper(unsafeContentWin, "top").top;

    for (var i = 0; i < this.browserWindows.length; i++) {
      this.browserWindows[i].openInTab(unsafeTop, url);
    }
  },

  evalInSandbox: function(code, codebase, sandbox, script) {
    if (!(Components.utils && Components.utils.Sandbox)) {
      var e = new Error("Could not create sandbox.");
      GM_logError(e, 0, e.fileName, e.lineNumber);
    } else {
      try {
        // workaround for https://bugzilla.mozilla.org/show_bug.cgi?id=307984
        var lineFinder = new Error();
        Components.utils.evalInSandbox(code, sandbox);
      } catch (e) {
        // try to find the line of the actual error line
        var line = e.lineNumber;
        if (4294967295 == line) {
          // Line number is reported as max int in edge cases.  Sometimes
          // the right one is in the "location", instead.  Look there.
          if (e.location && e.location.lineNumber) {
            line = e.location.lineNumber;
          } else {
            // Reporting max int is useless, if we couldn't find it in location
            // either, forget it.  Value of 0 isn't shown in the console.
            line = 0;
          }
        }

        if (line) {
          var err = this.findError(script, line - lineFinder.lineNumber - 1);
          GM_logError(
            e, // error obj
            0, // 0 = error (1 = warning)
            err.uri,
            err.lineNumber
          );
        } else {
          GM_logError(
            e, // error obj
            0, // 0 = error (1 = warning)
            script.uri,
            0
          );
        }
      }
    }
  },

  findError: function(script, lineNumber){
    var start = 0;
    var end = 1;

    for (var i = 0; i < script.offsets.length; i++) {
      end = script.offsets[i];
      if (lineNumber < end) {
        return {
          uri: getDependencyFileURI(script, script.requires[i]).spec,
          lineNumber: (lineNumber - start)
        };
      }
      start = end;
    }

    return {
      uri: script.uri,
      lineNumber: (lineNumber - end)
    };
  },

  getFirebugConsole: function(unsafeContentWin, chromeWin) {
    var firebugConsoleCtor = null;
    var firebugContext = null;

    if (chromeWin && chromeWin.FirebugConsole) {
      firebugConsoleCtor = chromeWin.FirebugConsole;
      firebugContext = chromeWin.top.TabWatcher
        .getContextByWindow(unsafeContentWin);

      // on first load (of multiple tabs) the context might not exist
      if (!firebugContext) firebugConsoleCtor = null;
    }

    if (firebugConsoleCtor && firebugContext) {
      return new firebugConsoleCtor(firebugContext, unsafeContentWin);
    } else {
      return null;
    }
  }

};
GM_XPI_SVC.wrappedJSObject = GM_XPI_SVC;
/* END SVC */

var GM_BrowserUI = new Object();

/**
 * nsISupports.QueryInterface
 */
GM_BrowserUI.QueryInterface = function(aIID) {
  if (!aIID.equals(Components.interfaces.nsISupports) &&
      !aIID.equals(Components.interfaces.gmIBrowserWindow) &&
      !aIID.equals(Components.interfaces.nsISupportsWeakReference) &&
      !aIID.equals(Components.interfaces.nsIWebProgressListener))
    throw Components.results.NS_ERROR_NO_INTERFACE;

  return this;
};


/**
 * Called when this file is parsed, by the last line. Set up initial objects,
 * do version checking, and set up listeners for browser xul load and location
 * changes.
 */
GM_BrowserUI.init = function() {
  this.menuCommanders = [];
  this.currentMenuCommander = null;
//  GM_updateVersion();
  GM_listen(window, "load", GM_hitch(this, "chromeLoad"));
  GM_listen(window, "unload", GM_hitch(this, "chromeUnload"));
};

/**
 * The browser XUL has loaded. Find the elements we need and set up our
 * listeners and wrapper objects.
 */
GM_BrowserUI.chromeLoad = function(e) {
  // get all required DOM elements
  this.tabBrowser = document.getElementById("content");
  this.appContent = document.getElementById("appcontent");
  this.contextMenu = {};//document.getElementById("contentAreaContextMenu");
  this.generalMenuEnabledItem = {};//document.getElementById("gm-general-menu-enabled-item");
  this.toolsMenu = {};//document.getElementById("menu_ToolsPopup");
  this.bundle = {};//document.getElementById("gm-browser-bundle");

  // seamonkey compat
/*  if (!this.toolsMenu) {
    this.toolsMenu = document.getElementById("taskPopup");
  }*/

  // songbird compat
  if (!this.appContent && this.tabBrowser) {
    this.appContent = this.tabBrowser.parentNode;
  }

  // update visual status when enabled state changes
  //this.enabledWatcher = GM_hitch(this, "refreshStatus");
  //GM_prefRoot.watch("enabled", this.enabledWatcher);
  // hook various events
  GM_listen(this.appContent, "DOMContentLoaded", GM_hitch(this, "contentLoad"));
//  GM_listen(this.contextMenu, "popupshowing", GM_hitch(this, "contextMenuShowing"));
//  GM_listen(this.toolsMenu, "popupshowing", GM_hitch(this, "toolsMenuShowing"));

  // we use this to determine if we are the active window sometimes
  this.winWat = Components.classes["@mozilla.org/embedcomp/window-watcher;1"]
                          .getService(Components.interfaces.nsIWindowWatcher);

  // this gives us onLocationChange
  this.tabBrowser.addProgressListener(this,
    Components.interfaces.nsIWebProgress.NOTIFY_LOCATION);

  // update enabled icon
  //this.refreshStatus();

};

/**
 * gmIBrowserWindow.registerMenuCommand
 */
GM_BrowserUI.registerMenuCommand = function(menuCommand) {
  if (this.isMyWindow(menuCommand.window)) {
    var commander = this.getCommander(menuCommand.window);

    commander.registerMenuCommand(menuCommand.name,
                                  menuCommand.doCommand,
                                  menuCommand.accelKey,
                                  menuCommand.accelModifiers,
                                  menuCommand.accessKey);
  }
};

/**
 * gmIBrowserWindow.openInTab
 */
GM_BrowserUI.openInTab = function(domWindow, url) {
  if (this.isMyWindow(domWindow)) {
    this.tabBrowser.addTab(url);
  }
};

/**
 * Gets called when a DOMContentLoaded event occurs somewhere in the browser.
 * If that document is in in the top-level window of the focused tab, find
 * it's menu items and activate them.
 */
GM_BrowserUI.contentLoad = function(e) {
  var safeWin;
  var unsafeWin;
  var href;
  var commander;

  safeWin = e.target.defaultView;
  unsafeWin = safeWin.wrappedJSObject;
  href = safeWin.location.href;

  if (GM_isGreasemonkeyable(href)) {
    commander = this.getCommander(unsafeWin);

    // if this content load is in the focused tab, attach the menuCommaander
/*    if (unsafeWin == this.tabBrowser.selectedBrowser.contentWindow) {
      this.currentMenuCommander = commander;
      this.currentMenuCommander.attach();
    }*/

    GM_XPI_SVC.domContentLoaded({ wrappedJSObject: unsafeWin }, window);
    //this.gmSvc.domContentLoaded({ wrappedJSObject: unsafeWin }, window);

    GM_listen(unsafeWin, "pagehide", GM_hitch(this, "contentUnload"));
  }
};


/**
 * The browser's location has changed. Usually, we don't care. But in the case
 * of tab switching we need to change the list of commands displayed in the
 * User Script Commands submenu.
 */
GM_BrowserUI.onLocationChange = function(a,b,c) {
/*  if (this.currentMenuCommander != null) {
    this.currentMenuCommander.detach();
    this.currentMenuCommander = null;
  }

  var menuCommander = this.getCommander(this.tabBrowser.selectedBrowser.
                                        contentWindow);

  if (menuCommander) {
    this.currentMenuCommander = menuCommander;
    //this.currentMenuCommander.attach();
  }*/
};

/**
 * A content document has unloaded. We need to remove it's menuCommander to
 * avoid leaking it's memory.
 */
GM_BrowserUI.contentUnload = function(e) {
  if (e.persisted) {
    return;
  }

  var unsafeWin = e.target.defaultView;

  // remove the commander for this document
  var commander = null;

  // looping over commanders rather than using getCommander because we need
  // the index into commanders.splice.
/*  for (var i = 0; item = this.menuCommanders[i]; i++) {
    if (item.win == unsafeWin) {

      if (item.commander == this.currentMenuCommander) {
        this.currentMenuCommander.detach();
        this.currentMenuCommander = null;
      }

      this.menuCommanders.splice(i, 1);

      break;
    }
  }*/
};

/**
 * The browser XUL has unloaded. We need to let go of the pref watcher so
 * that a non-existant window is not informed when greasemonkey enabled state
 * changes. And we need to let go of the progress listener so that we don't
 * leak it's memory.
 */
GM_BrowserUI.chromeUnload = function() {
  GM_prefRoot.unwatch("enabled", this.enabledWatcher);
  this.tabBrowser.removeProgressListener(this);
  //this.gmSvc.unregisterBrowser(this);
  delete this.menuCommanders;
};

/**
 * Called when the content area context menu is showing. We figure out whether
 * to show our context items.
 */
GM_BrowserUI.contextMenuShowing = function() {
  var contextItem = ge("view-userscript");
  var contextSep = ge("install-userscript-sep");

  var culprit = document.popupNode;

  while (culprit && culprit.tagName && culprit.tagName.toLowerCase() != "a") {
     culprit = culprit.parentNode;
  }

  contextItem.hidden =
    contextSep.hidden =
    !this.getUserScriptLinkUnderPointer();
};

/**
 * Helper method which gets the menuCommander corresponding to a given
 * document
 */
GM_BrowserUI.getCommander = function(unsafeWin) {
/*  for (var i = 0; i < this.menuCommanders.length; i++) {
    if (this.menuCommanders[i].win == unsafeWin) {
      return this.menuCommanders[i].commander;
    }
  }

  // no commander found. create one and add it.
  var commander = new GM_MenuCommander(document);
  this.menuCommanders.push({win:unsafeWin, commander:commander});

  return commander;*/
return {};
};

/**
 * Helper to determine if a given dom window is in this tabbrowser
 */
GM_BrowserUI.isMyWindow = function(domWindow) {
  var tabbrowser = getBrowser();
  var browser;

  for (var i = 0; browser = tabbrowser.browsers[i]; i++) {
    if (browser.contentWindow == domWindow) {
      return true;
    }
  }

  return false;
};

function GM_showGeneralPopup(aEvent) {
  // set the enabled/disabled state
//  GM_BrowserUI.generalMenuEnabledItem.setAttribute("checked", GM_getEnabled());
};

function GM_showPopup(aEvent) {
/*  var config = new Config();
  config.load();
  var popup = aEvent.target;
  var url = getBrowser().contentWindow.document.location.href;

  // set the enabled/disabled state
  GM_BrowserUI.statusEnabledItem.setAttribute("checked", GM_getEnabled());

  // remove all the scripts from the list
  for (var i = popup.childNodes.length - 1; i >= 0; i--) {
    if (popup.childNodes[i].hasAttribute("value")) {
      popup.removeChild(popup.childNodes[i]);
    }
  }

  var foundInjectedScript = false;

  // build the new list of scripts
  for (var i = 0, script = null; script = config.scripts[i]; i++) {
    incloop: for (var j = 0; j < script.includes.length; j++) {
      var pattern = convert2RegExp(script.includes[j]);
      if (pattern.test(url)) {
        for (var k = 0; k < script.excludes.length; k++) {
          pattern = convert2RegExp(script.excludes[k]);
          if (pattern.test(url)) {
            break incloop;
          }
        }

        foundInjectedScript = true;

        var mi = document.createElement('menuitem');
        mi.setAttribute('label', script.name);
        mi.setAttribute('value', i);
        mi.setAttribute('type', 'checkbox');
        mi.setAttribute('checked', script.enabled.toString());

        popup.insertBefore(mi, document.getElementById("gm-status-no-scripts-sep"));

        break incloop;
      }
    }
  }

  document.getElementById("gm-status-no-scripts").collapsed = foundInjectedScript;*/
};

/**
 * Handle clicking one of the items in the popup. Left-click toggles the enabled
 * state, rihgt-click opens in an editor.
 */
function GM_popupClicked(aEvent) {
};

/**
 * Greasemonkey's enabled state has changed, either as a result of clicking
 * the icon in this window, clicking it in another window, or even changing
 * the mozilla preference that backs it directly.
 */
GM_BrowserUI.refreshStatus = function() {
};

GM_BrowserUI.showStatus = function(message, autoHide) {
  if (this.statusLabel.collapsed) {
    this.statusLabel.collapsed = false;
  }

  message += " ";

  var box = document.createElement("vbox");
  var label = document.createElement("label");
  box.style.position = "fixed";
  box.style.left = "-10000px";
  box.style.top = "-10000px";
  box.style.border = "5px solid red";
  box.appendChild(label);
  document.documentElement.appendChild(box);
  label.setAttribute("value", message);

  var current = parseInt(this.statusLabel.style.width);
  this.statusLabel.value = message;
  var max = label.boxObject.width;

  this.showAnimation = new Accelimation(this.statusLabel.style,
                                          "width", max, 300, 2, "px");
  this.showAnimation.onend = GM_hitch(this, "showStatusAnimationEnd", autoHide);
  this.showAnimation.start();
};

GM_BrowserUI.showStatusAnimationEnd = function(autoHide) {
  this.showAnimation = null;

  if (autoHide) {
    this.setAutoHideTimer();
  }
};

GM_BrowserUI.setAutoHideTimer = function() {
  if (this.autoHideTimer) {
    window.clearTimeout(this.autoHideTimer);
  }

  this.autoHideTimer = window.setTimeout(GM_hitch(this, "hideStatus"), 3000);
};

GM_BrowserUI.hideStatusImmediately = function() {
  if (this.showAnimation) {
    this.showAnimation.stop();
    this.showAnimation = null;
  }

  if (this.hideAnimation) {
    this.hideAnimation.stop();
    this.hideAnimation = null;
  }

  if (this.autoHideTimer) {
    window.clearTimeout(this.autoHideTimer);
    this.autoHideTimer = null;
  }

  this.statusLabel.style.width = "0";
  this.statusLabel.collapsed = true;
};

GM_BrowserUI.hideStatus = function() {
  if (!this.hideAnimation) {
    this.autoHideTimer = null;
    this.hideAnimation = new Accelimation(this.statusLabel.style,
                                            "width", 0, 300, 2, "px");
    this.hideAnimation.onend = GM_hitch(this, "hideStatusAnimationEnd");
    this.hideAnimation.start();
  }
};

GM_BrowserUI.hideStatusAnimationEnd = function() {
  this.hideAnimation = null;
  this.statusLabel.collapsed = true;
};

// necessary for webProgressListener implementation
GM_BrowserUI.onProgressChange = function(webProgress,b,c,d,e,f){}
GM_BrowserUI.onStateChange = function(a,b,c,d){}
GM_BrowserUI.onStatusChange = function(a,b,c,d){}
GM_BrowserUI.onSecurityChange = function(a,b,c){}
GM_BrowserUI.onLinkIconAvailable = function(a){}

GM_BrowserUI.showHorrayMessage = function(scriptName) {
  this.showStatus("'" + scriptName + "' " + this.bundle.getString("statusbar.installed"), true);
};

GM_BrowserUI.viewContextItemClicked = function() {
};

log("calling init...");
GM_BrowserUI.init();
