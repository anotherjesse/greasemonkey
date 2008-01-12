var args = null;

function init() {
  try {
    args = window.arguments[0];
    document.getElementById("from").value = args.from;
    document.getElementById("to").value = args.to;
  } catch (e) {
    GM_log("Error in xhrwarning.js init(): " + e);
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
