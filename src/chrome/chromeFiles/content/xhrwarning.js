var args = null;
var timer = null;
var seconds = 0;
var acceptButton;
var denyButton;

function init() {
  try {
    args = window.arguments[0];
    document.getElementById("from").value = args.from;
    document.getElementById("to").value = args.to;
    acceptButton = document.getElementById("greasemonkey").getButton("accept");
    acceptButton.baseLabel = "Allow";
    denyButton = document.getElementById("greasemonkey").getButton("cancel");
    // focus deny button by default, have to do this after onload.
    window.setTimeout(function() {
      denyButton.focus();
    }, 1);
    startTimer();
  } catch (e) {
    alert("Error in xhrwarning.js init(): " + e);
  }
}

function allow() {
  args.remember = document.getElementById("remember").checked;
  args.result = true;
}

function deny() {
  args.remember = document.getElementById("remember").checked;
  args.result = false;
}

function startTimer() {
  seconds = 4;
  updateLabel();

  if (timer) {
    window.clearInterval(timer);
  }

  timer = window.setInterval(function() { onInterval() }, 500);
}

function onInterval() {
  seconds--;
  updateLabel();

  if (seconds == 0) {
    timer = window.clearInterval(timer);
  }
}

function stopTimer() {
  seconds = 5;
  timer = window.clearInterval(timer);
  updateLabel();
}

function updateLabel() {
  if (seconds > 0) {
    acceptButton.focus();
    acceptButton.disabled = true;
    acceptButton.label = acceptButton.baseLabel + " (" + seconds + ")";
  } else {
    acceptButton.disabled = false;
    acceptButton.label = acceptButton.baseLabel;
  }
}
