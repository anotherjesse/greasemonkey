/**
 * Implements the UI for the install dialog.
 *
 * @constructor
 * @param {nsIDOMWindow} win  An instance of the install dialog.
 */
function InstallWindow(win) {
  this.win = win;
  this.doc = win.document;

  GM_listen(this.win, "load", GM_hitch(this, "chromeLoad"));
}

/**
 * Called when the install window loads. Init all the controls and start the
 * countdown timer.
 */
InstallWindow.prototype.chromeLoad = function() {
  var ioservice = Cc["@mozilla.org/network/io-service;1"]
                    .getService(Ci.nsIIOService);

  this.htmlNs_ = "http://www.w3.org/1999/xhtml";

  this.scriptDownloader_ = this.win.arguments[0];
  this.script_ = this.scriptDownloader_.script;

  this.setupIncludes("includes", "includes-desc", this.script_.includes);
  this.setupIncludes("excludes", "excludes-desc", this.script_.excludes);

  this.dialog_ = this.doc.documentElement;
  this.extraButton_ = this.dialog_.getButton("extra1");
  this.extraButton_.setAttribute("type", "checkbox");

  this.acceptButton_ = this.dialog_.getButton("accept");
  this.acceptButton_.baseLabel = this.acceptButton_.label;

  this.timer_ = null;
  this.seconds_ = 0;
  this.startTimer();

  this.bundle = this.doc.getElementById("gm-browser-bundle");
  this.greetz = new Array();
  for(var i = 0; i < 6; i++){
    this.greetz.push(this.bundle.getString('greetz.' + i));
  }

  var pick = Math.round(Math.random() * (this.greetz.length - 1));
  var heading = this.doc.getElementById("heading");
  heading.appendChild(this.doc.createElementNS(this.htmlNs_, "strong"));
  heading.firstChild.appendChild(this.doc.createTextNode(this.greetz[pick]));
  heading.appendChild(this.doc.createTextNode(" " + this.bundle.getString("greeting.msg")));

  var desc = this.doc.getElementById("scriptDescription");
  desc.appendChild(this.doc.createElementNS(this.htmlNs_, "strong"));
  desc.firstChild.appendChild(this.doc.createTextNode(this.script_.name));
  desc.appendChild(this.doc.createElementNS(this.htmlNs_, "br"));
  desc.appendChild(this.doc.createTextNode(this.script_.description));
};

/**
 * Called when the window is focused. Restart the timer.
 */
InstallWindow.prototype.onFocus = function() {
  this.startTimer();
};

/**
 * Called when the window is blurred. Pause the timer.
 */
InstallWindow.prototype.onBlur = function() {
  this.stopTimer();
};

/**
 * Helper to start the countdown timer.
 */
InstallWindow.prototype.startTimer = function() {
  this.seconds_ = 4;
  this.updateLabel();

  if (this.timer_) {
    this.win.clearInterval(this.timer_);
  }

  this.timer_ = this.win.setInterval(GM_hitch(this, "onInterval"), 500);
};

/**
 * Called each time the timer goes off. Count down until the user can install.
 */
InstallWindow.prototype.onInterval = function() {
  this.seconds_--;
  this.updateLabel();

  if (this.seconds_ == 0) {
    this.timer_ = this.win.clearInterval(this.timer_);
  }
};

/**
 * Helper to stop the countdown timer.
 */
InstallWindow.prototype.stopTimer = function() {
  this.seconds_ = 5;
  this.timer_ = this.win.clearInterval(this.timer_);
  this.updateLabel();
};

/**
 * Helper to update the text on the label based on the current count.
 */
InstallWindow.prototype.updateLabel = function() {
  if (this.seconds_ > 0) {
    this.acceptButton_.focus();
    this.acceptButton_.disabled = true;
    this.acceptButton_.label = 
      this.acceptButton_.baseLabel + " (" + this.seconds_ + ")";
  } else {
    this.acceptButton_.disabled = false;
    this.acceptButton_.label = this.acceptButton_.baseLabel;
  }
};

/**
 * Helper to render the pages that the script will be run on.
 *
 * @param {String} box  The id of the include box.
 * @param {String} desc  The id of the description box that gets the includes.
 * @param {Array<String>} includes  Array of includes this script will be run
 *   on.
 */
InstallWindow.prototype.setupIncludes = function(box, desc, includes) {
  if (includes.length > 0) {
    desc = this.doc.getElementById(desc);
    this.doc.getElementById(box).style.display = "";

    for (var i = 0; i < includes.length; i++) {
      desc.appendChild(this.doc.createTextNode(includes[i]));
      desc.appendChild(this.doc.createElementNS(this.htmlNs_, "br"));
    }

    desc.removeChild(desc.lastChild);
  }
};

/**
 * Called when the OK button is clicked. Install the script and show a success
 * message.
 */
InstallWindow.prototype.onOK = function() {
  var config = new Config();
  config.load();
  config.install(this.script_);
  this.win.opener.GM_browserWindow.showHorrayMessage(this.script_.name);
  this.win.setTimeout("window.close()", 0);
};

/**
 * Called when the dialog is dismissed.
 */
InstallWindow.prototype.onCancel = function(){
  this.win.close();
};

/**
 * Called when the 'show script source' button is clicked.
 */
InstallWindow.prototype.onShowSource = function() {
  this.scriptDownloader_.showScriptView();
  this.win.setTimeout("window.close()", 0);
};
