/**
 * Implements the Greasemonkey UI for the main browser window. Also catches 
 * DOMContentLoaded and starts script injection.
 *
 * @constructor
 * @param {nsIDOMWindow} win  An instance of the main browser window.
 */
function BrowserWindow(win) {
  this.win = win;
  this.doc = win.document;
  this.menuCommanders = [];
  this.currentMenuCommander = null;

  GM_updateVersion();

  // TODO(aa): We should use bind() and partial() and kill GM_hitch.
  GM_listen(this.win, "load", GM_hitch(this, "chromeLoad"));
  GM_listen(this.win, "unload", GM_hitch(this, "chromeUnload"));
}

/**
 * XPCOM goop. Mozilla is asking if we have a given interface. We always say
 * yes.
 */
BrowserWindow.prototype.QueryInterface = function(iid) {
  return this;
};

/**
 * The browser XUL has loaded. Find the elements we need and set up our
 * listeners and wrapper objects.
 *
 * @param {nsIDOMEvent} e  Event details sent by Mozilla.
 */
BrowserWindow.prototype.chromeLoad = function(e) {
  // get all required DOM elements
  this.tabBrowser = this.doc.getElementById("content");
  this.appContent = this.doc.getElementById("appcontent");
  this.contextMenu = this.doc.getElementById("contentAreaContextMenu");
  this.statusImage = this.doc.getElementById("gm-status-image");
  this.statusLabel = this.doc.getElementById("gm-status-label");
  this.statusPopup = this.doc.getElementById("gm-status-popup");
  this.statusEnabledItem = this.doc.getElementById("gm-status-enabled-item");
  this.toolsMenu = this.doc.getElementById("menu_ToolsPopup");
  this.bundle = this.doc.getElementById("gm-browser-bundle");

  // seamonkey compat
  if (!this.toolsMenu) {
    this.toolsMenu = this.doc.getElementById("taskPopup");
  }

  // update visual status when enabled state changes
  this.enabledWatcher = GM_hitch(this, "refreshStatus");
  GM_prefRoot.watch("enabled", this.enabledWatcher);

  // hook various events
  GM_listen(this.appContent, "DOMContentLoaded", GM_hitch(this, "contentLoad"));
  GM_listen(this.contextMenu, "popupshowing", GM_hitch(this, "contextMenuShowing"));
  GM_listen(this.toolsMenu, "popupshowing", GM_hitch(this, "toolsMenuShowing"));

  // listen for clicks on the install bar
  Cc["@mozilla.org/observer-service;1"]
    .getService(Ci.nsIObserverService)
    .addObserver(this, "install-userscript", true);

  // we use this to determine if we are the active window sometimes
  this.winWat = Cc["@mozilla.org/embedcomp/window-watcher;1"]
                  .getService(Ci.nsIWindowWatcher);

  // this gives us onLocationChange
  this.doc.getElementById("content").addProgressListener(
    this, Ci.nsIWebProgress.NOTIFY_LOCATION);

  // update enabled icon
  this.refreshStatus();

  // register for notifications from greasemonkey-service about ui type things
  greasemonkeyService.registerBrowser(this);
}

/**
 * Register a command to be displayed in the tools menu. This is called by
 * GreasemonkeyService as user scripts execute.
 *
 * Note that since GreasemonkeyService does not know which scripts go with 
 * which BrowserWindows, it tells all instances. This method has to filter
 * commands for other windows out.
 *
 * @param {Object} menuCommand  Details about command to register.
 */
BrowserWindow.prototype.registerMenuCommand = function(menuCommand) {
  if (this.isMyWindow(menuCommand.window)) {
    var commander = this.getCommander(menuCommand.window);

    commander.registerMenuCommand(menuCommand.name,
                                  menuCommand.doCommand,
                                  menuCommand.accelKey,
                                  menuCommand.accelModifiers,
                                  menuCommand.accessKey);
  }
}

/**
 * Open the specified url in a new tab. Called by GreasemonkeyService as user
 * scripts execute.
 *
 * @param {nsIDOMWindow} domWindow  Tab should only be opened if this window
 * is the window we are controlling.
 * @param {String} url  The url to open.
 */
BrowserWindow.prototype.openInTab = function(domWindow, url) {
  if (this.isMyWindow(domWindow)) {
    this.doc.getElementById("content").addTab(url);
  }
}

/**
 * Gets called when a DOMContentLoaded event occurs somewhere in the browser.
 * If that document is in in the top-level window of the focused tab, find 
 * it's menu items and activate them.
 *
 * @param {nsIDOMEvent} e  Details about the event.
 */
BrowserWindow.prototype.contentLoad = function(e) {
  var unsafeWin;
  var href;
  var commander;

  if (!GM_getEnabled()) {
    return;
  }

  // TODO: We only support 1.5 now, which is always deep wrappers. Remove this.
  if (GM_deepWrappersEnabled(this.win)) {
    // when deep wrappers are enabled, e.target is already a deep xpcnw
    unsafeWin = e.target.defaultView;

    // in DPa2, there was a bug that made this *not* a deep wrapper.
    // TODO: Remove
    if (unsafeWin.wrappedJSObject) {
      unsafeWin = unsafeWin.wrappedJSObject;
    }

    href = e.target.location.href;
  } else {
    // otherwise we need to wrap it manually
    unsafeWin = new XPCNativeWrapper(
                  new XPCNativeWrapper(e, "target").target,
                  "defaultView").defaultView;
    href = new XPCNativeWrapper(
              new XPCNativeWrapper(unsafeWin, "location").location,
              "href").href;
  }

  if (GM_isGreasemonkeyable(href)) {
    commander = this.getCommander(unsafeWin);

    // if this content load is in the focused tab, attach the menuCommaander  
    if (unsafeWin == this.tabBrowser.selectedBrowser.contentWindow) {
      this.currentMenuCommander = commander;
      this.currentMenuCommander.attach();
    }

    // TODO: This can be simpler in the one-big-scope world.
    greasemonkeyService.domContentLoaded({ wrappedJSObject: unsafeWin });
  
    GM_listen(unsafeWin, "pagehide", GM_hitch(this, "contentUnload"));
  }

  if (!href.match(/\.user\.js$/)) {
    return;
  }

  var browser = this.tabBrowser.selectedBrowser;
  var greeting = this.bundle.getString("greeting.msg");

  if (this.tabBrowser.showMessage) {
    // Firefox 1.5 and lower
    this.tabBrowser.showMessage(
      browser,
      "chrome://greasemonkey/content/status_on.gif",
      greeting,
      this.bundle.getString('greeting.btn'),
      null /* default doc shell */,
      "install-userscript",
      null /* no popuup */,
      "top",
      true /* show close button */,
      "I" /* access key */);
  } else {
    // Firefox 2.0+
    var notificationBox = this.tabBrowser.getNotificationBox(browser);
  
    // Remove existing notifications. Notifications get removed
    // automatically onclick and on page navigation, but we need to remove
    // them ourselves in the case of reload, or they stack up.
    for (var i = 0, child; child = notificationBox.childNodes[i]; i++) {
      if (child.getAttribute("value") == "install-userscript") {
	notificationBox.removeNotification(child);
      }
    }

    var notification = notificationBox.appendNotification(
      greeting,
      "install-userscript",
      "chrome://greasemonkey/content/status_on.gif",
      notificationBox.PRIORITY_WARNING_MEDIUM,
      [{ label: this.bundle.getString('greeting.btn'),
	 accessKey: "I",
	 popup: null,
	 callback: GM_hitch(this, "installCurrentScript") }]);
  }
};

/**
 * Called from greasemonkey service when we should load a user script. 
 *
 * @param {String} uri  The uri of the script to install.
 * @param {Boolean} timer  If false, we delay for a moment to get out of
 *   the way of nsIContentPolicy.shouldLoad.
 *
 * TODO: This should be moved somewhere else. Probably GreasemonkeyService
 * could just call ScriptDownloader directly?
 */
BrowserWindow.prototype.startInstallScript = function(uri, timer) {
  if (!timer) {
    // docs for nsicontentpolicy say we're not supposed to block, so short 
    // timer.
    var self = this;
    this.win.setTimeout(
      function() { self.startInstallScript(uri, true) }, 0);

    return;
  }

  this.scriptDownloader_ = new ScriptDownloader(this.win, uri, this.bundle);
  this.scriptDownloader_.startInstall();
};


/**
 * Open the tab to show the contents of a script and display the banner to let
 * the user install it.
 *
 * @param {ScriptDownloader} scriptDownloader  An instance of scriptDownloader
 * that has finished downloading a script.
 */
BrowserWindow.prototype.showScriptView = function(scriptDownloader) {
  this.scriptDownloader_ = scriptDownloader;

  var ioSvc = Cc["@mozilla.org/network/io-service;1"]
                        .getService(Ci.nsIIOService);
  var uri = ioSvc.newFileURI(scriptDownloader.script.file);

  var tab = this.tabBrowser.addTab(uri.spec);
  var browser = this.tabBrowser.getBrowserForTab(tab);

  this.tabBrowser.selectedTab = tab;

};

/**
 * Implements nsIObserver.observe. Right now we're only observing our own
 * install-userscript, which happens when the install bar is clicked.
 *
 * @see nsIObserver
 */
BrowserWindow.prototype.observe = function(subject, topic, data) {
  if (topic == "install-userscript") {
    if (this.win == this.winWat.activeWindow) {
      this.installCurrentScript();
    }
  } else {
    throw new Error("Unexpected topic received: {" + topic + "}");
  }
};

/**
 * Handles the install button on the yellow banner getting clicked.
 */
BrowserWindow.prototype.installCurrentScript = function() {
  var config = new Config();
  config.load();
  config.install(this.scriptDownloader_.script);
  this.showHorrayMessage(this.scriptDownloader_.script.name);
};


/**
 * The browser's location has changed. Usually, we don't care. But in the case
 * of tab switching we need to change the list of commands displayed in the
 * User Script Commands submenu.
 *
 * @see nsIWebProgressListener
 */
BrowserWindow.prototype.onLocationChange = function(a,b,c) {
  if (this.currentMenuCommander != null) {
    this.currentMenuCommander.detach();
    this.currentMenuCommander = null;
  }

  var menuCommander = this.getCommander(this.tabBrowser.selectedBrowser.
                                        contentWindow);
  
  if (menuCommander) {
    this.currentMenuCommander = menuCommander;
    this.currentMenuCommander.attach();
  }
}

// necessary for webProgressListener implementation
BrowserWindow.prototype.onProgressChange = function(webProgress,b,c,d,e,f){}
BrowserWindow.prototype.onStateChange = function(a,b,c,d){}
BrowserWindow.prototype.onStatusChange = function(a,b,c,d){}
BrowserWindow.prototype.onSecurityChange = function(a,b,c){}
BrowserWindow.prototype.onLinkIconAvailable = function(a){}

/**
 * A content document has unloaded. We need to remove it's menuCommander to 
 * avoid leaking it's memory.
 *
 * @param {nsIDOMEvent} e  Details about the event.
 */
BrowserWindow.prototype.contentUnload = function(e) {
  if (e.persisted) {
    return;
  }

  var unsafeWin = e.target.defaultView;

  // remove the commander for this document  
  var commander = null;
  
  // looping over commanders rather than using getCommander because we need
  // the index into commanders.splice.
  for (var i = 0; item = this.menuCommanders[i]; i++) {
    if (item.win == unsafeWin) {

      log("* Found corresponding commander. Is currentMenuCommander: " + 
          (item.commander == this.currentMenuCommander));

      if (item.commander == this.currentMenuCommander) {
        this.currentMenuCommander.detach();
        this.currentMenuCommander = null;
      }
      
      this.menuCommanders.splice(i, 1);

      log("* Found and removed corresponding commander")
      break;
    }
  }
}

/**
 * The browser XUL has unloaded. We need to let go of the pref watcher so
 * that a non-existant window is not informed when greasemonkey enabled state
 * changes. And we need to let go of the progress listener so that we don't
 * leak it's memory.
 */
BrowserWindow.prototype.chromeUnload = function() {
  GM_prefRoot.unwatch("enabled", this.enabledWatcher);
  this.tabBrowser.removeProgressListener(this);
  greasemonkeyService.unregisterBrowser(this);
  delete this.menuCommanders;
}

/**
 * Called when the content area context menu is showing. We figure out whether
 * to show our context items.
 */
BrowserWindow.prototype.contextMenuShowing = function() {
  var contextItem = this.doc.getElementById("view-userscript");
  var contextSep = this.doc.getElementById("install-userscript-sep");

  var culprit = this.doc.popupNode;

  while (culprit && culprit.tagName && culprit.tagName.toLowerCase() != "a") {
     culprit = culprit.parentNode;
  }

  contextItem.hidden =
    contextSep.hidden =
    !this.getUserScriptLinkUnderPointer();
}

/**
 * Called in an onpopupshowing event. Get the user script link, if any, which
 * is under the mouse pointer.
 *
 * @returns {nsIURI}  The uri of the script under the pointer, or null if no
 *   such script exists.
 */
BrowserWindow.prototype.getUserScriptLinkUnderPointer = function() {
  var culprit = this.doc.popupNode;

  while (culprit && culprit.tagName && culprit.tagName.toLowerCase() != "a") {
     culprit = culprit.parentNode;
  }

  if (!culprit || !culprit.href ||
      !culprit.href.match(/\.user\.js(\?|$)/i)) {
    return null;
  }

  var ioSvc = Cc["@mozilla.org/network/io-service;1"]
                        .getService(Ci.nsIIOService);
  var uri = ioSvc.newURI(culprit.href, null, null);

  return uri;
}

/**
 * Called when the tools menu is shown. Set the menu to the correct state.
 */
BrowserWindow.prototype.toolsMenuShowing = function() {
  var installItem = this.doc.getElementById("userscript-tools-install");
  var collapsed = true;

  if (this.win._content && this.win._content.location &&
      this.win.content.location.href.match(/\.user\.js(\?|$)/i)) {
    collapsed = false;
  }

  installItem.setAttribute("collapsed", collapsed.toString());
}

/**
 * Helper method which gets the menuCommander corresponding to a given 
 * document
 */
BrowserWindow.prototype.getCommander = function(unsafeWin) {
  for (var i = 0; i < this.menuCommanders.length; i++) {
    if (this.menuCommanders[i].win == unsafeWin) {
      return this.menuCommanders[i].commander;
    }
  }

  // no commander found. create one and add it.
  var commander = new GM_MenuCommander(this.doc);
  this.menuCommanders.push({win:unsafeWin, commander:commander});

  return commander;
}

/**
 * Helper to determine if a given dom window is in this tabbrowser.
 */
BrowserWindow.prototype.isMyWindow = function(domWindow) {
  var browser;

  for (var i = 0; browser = this.tabBrowser.browsers[i]; i++) {
    if (browser.contentWindow == domWindow) {
      return true;
    }
  }

  return false;
}

/**
 * Called when the monkey menu is shown. Set the correct menu items.
 *
 * @param {nsIDOMEvent} e  Details about the event.
 */
BrowserWindow.prototype.setupMonkeyMenu = function(e) {
  var config = new Config(getScriptFile("config.xml"));
  config.load();
  var popup = e.target;
  var url = this.tabBrowser.contentWindow.document.location.href;

  // set the enabled/disabled state
  this.statusEnabledItem.setAttribute("checked", GM_getEnabled());

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

        var mi = this.doc.createElement('menuitem');
        mi.setAttribute('label', script.name);
        mi.setAttribute('value', i);
        mi.setAttribute('type', 'checkbox');
        mi.setAttribute('checked', script.enabled.toString());

        popup.insertBefore(mi, this.doc.getElementById("gm-status-no-scripts-sep"));

        break incloop;
      }
    }
  }

  this.doc.getElementById("gm-status-no-scripts").collapsed = foundInjectedScript;
}

/**
 * Handle clicking one of the items in the popup. Left-click toggles the enabled 
 * state, right-click opens in an editor.
 *
 * @param {nsIDOMEvent} e  Details about the click event.
 */
BrowserWindow.prototype.monkeyMenuClicked = function(e) {
  if (e.button == 0 || e.button == 2) {
    var config = new Config(getScriptFile("config.xml"));
    config.load();
    var scriptNum=e.target.value;
    if (!config.scripts[scriptNum]) return;

    if (e.button == 0) {
      // left-click: toggle enabled state
      config.scripts[scriptNum].enabled=!config.scripts[scriptNum].enabled;
      config.save();
    } else {
      // right-click: open in editor
      openInEditor(getScriptFile(config.scripts[scriptNum].filename),
      this.doc.getElementById("gm-browser-bundle").getString("editor.prompt"))
    }

    closeMenus(e.target);
  }
}

/**
 * Toggle Greasemonkey's enabled state.
 */
BrowserWindow.prototype.toggleEnabled = function() {
  GM_setEnabled(!GM_getEnabled());
};

/**
 * Greasemonkey's enabled state has changed, either as a result of clicking
 * the icon in this window, clicking it in another window, or even changing
 * the mozilla preference that backs it directly.
 */
BrowserWindow.prototype.refreshStatus = function() {
  if (GM_getEnabled()) {
    this.statusImage.src = "chrome://greasemonkey/content/status_on.gif";
    this.statusImage.tooltipText = this.bundle.getString('tooltip.enabled');
  } else {
    this.statusImage.src = "chrome://greasemonkey/content/status_off.gif";
    this.statusImage.tooltipText = this.bundle.getString('tooltip.disabled');
  }

  this.statusImage.style.opacity = "1.0";
}

/**
 * Called when the 'new user script' menu item is clicked. Create a new user
 * script source file and open it in an editor.
 */
BrowserWindow.prototype.newUserScript = function() {
  var tempname = "newscript.user.js";
  
  var source = getContentDir();
  source.append("template.user.js");
  
  var dest = Cc["@mozilla.org/file/directory_service;1"]
                       .getService(Ci.nsIProperties)
                       .get("TmpD", Ci.nsILocalFile);
        
  var destFile = dest.clone().QueryInterface(Ci.nsILocalFile);
  destFile.append(tempname);
  
  if (destFile.exists()) {
    destFile.remove(false);
  }

  source.copyTo(dest, tempname);

  openInEditor(
    destFile,
    this.bundle.getString("editor.prompt"));
}

/**
 * Shows an animated status message which slides out to the left of the monkey
 * icon.
 *
 * @param {String} message  The message to show.
 * @param {Boolean} autoHide  If true, the message is automatically hidden
 *   after a few moments. Otherwise, you must call hideStatus manually.
 */
BrowserWindow.prototype.showStatus = function(message, autoHide) {
  if (this.statusLabel.collapsed) {
    this.statusLabel.collapsed = false;
  }

  message += " ";

  var box = this.doc.createElement("vbox");
  var label = this.doc.createElement("label");
  box.style.position = "fixed";
  box.style.left = "-10000px";
  box.style.top = "-10000px";
  box.style.border = "5px solid red";
  box.appendChild(label);
  this.doc.documentElement.appendChild(box);
  label.setAttribute("value", message);

  var current = parseInt(this.statusLabel.style.width);
  this.statusLabel.value = message;
  var max = label.boxObject.width;

  this.showAnimation = new Accelimation(this.statusLabel.style, 
                                        "width", max, 300, 2, "px");
  this.showAnimation.onend = 
    GM_hitch(this, "showStatusAnimationEnd", autoHide);

  this.showAnimation.start();
}

/**
 * Called when the show status animation is complete.
 *
 * @param {Boolean} autoHide  True if the message should be automatically
 *   hidden.
 */
BrowserWindow.prototype.showStatusAnimationEnd = function(autoHide) {
  this.showAnimation = null;

  if (autoHide) {
    this.setAutoHideTimer();
  }
}

/**
 * Set the status message to be hidden in a few moments.
 */
BrowserWindow.prototype.setAutoHideTimer = function() {
  if (this.autoHideTimer) {
    this.win.clearTimeout(this.autoHideTimer);
  }

  this.autoHideTimer = this.win.setTimeout(GM_hitch(this, "hideStatus"), 3000);
}

/**
 * Hide the status message.
 */
BrowserWindow.prototype.hideStatus = function() {
  if (!this.hideAnimation) {
    this.autoHideTimer = null;
    this.hideAnimation = new Accelimation(this.statusLabel.style, 
                                            "width", 0, 300, 2, "px");
    this.hideAnimation.onend = GM_hitch(this, "hideStatusAnimationEnd");
    this.hideAnimation.start();
  }
}

/**
 * Called when the hide status message animation is done.
 */
BrowserWindow.prototype.hideStatusAnimationEnd = function() {
  this.hideAnimation = null;
  this.statusLabel.collapsed = true;
}

/**
 * Show the 'script installed successfully' message.
 *
 * @param {String} scriptName  The name of the script which was installed.
 */
BrowserWindow.prototype.showHorrayMessage = function(scriptName) {
  this.showStatus("'" + scriptName + "' " + 
                    this.bundle.getString("statusbar.installed"), 
                  true);
}

/**
 * Called when the 'install user script' menu item is clicked. Start a script
 * downloader to download and then install the script.
 */
BrowserWindow.prototype.installMenuItemClicked = function() {
  this.startInstallScript(this.win.location.href);
}

/**
 * Called when the 'view user script' context menu item is clicked. Start a
 * script downloader to download and then view the script.
 */
BrowserWindow.prototype.viewContextItemClicked = function() {
  var uri = this.getUserScriptLinkUnderPointer();

  this.scriptDownloader_ = new ScriptDownloader(this.win, uri, this.bundle);
  this.scriptDownloader_.startViewScript();
}

/**
 * Called when the 'manage user scripts' menu item is clicked. Open the manage
 * dialog.
 */
BrowserWindow.prototype.manageMenuItemClicked = function() {
   this.win.openDialog("chrome://greasemonkey/content/manage.xul", "manager", 
    "resizable,centerscreen,modal");
}

//loggify(BrowserWindow.prototype, "BrowserWindow");

log("calling init...")
