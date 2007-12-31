var GM_prefRoot = new GM_PrefManager();

/**
 * Flags for the various types we can currently store. These names don't
 * correspond to JavaScript types because we might want to store things in the
 * future that don't have their own typenames in JavaScript, like Date.
 */
GM_PrefManager.TypeFlag = {
  Boolean: 1,
  Number: 2,
  String: 3
};

/**
 * Simple API on top of preferences for greasemonkey.
 * Construct an instance by passing the startPoint of a preferences subtree.
 * "greasemonkey." prefix is assumed.
 */
function GM_PrefManager(startPoint) {
  if (!startPoint) {
    startPoint = "";
  }

  // At Greasemonkey 0.8 we expanded the types storable by GM_setValue beyond
  // the types supported by the underlying Mozilla preferences service. Because
  // of this, we needed to serialize the values and tag them with their type.
  // This was a non-backwards-compatible format change, so we created a new
  // branch to store this new style value in.
  // We only ever write to pref2 but we try to read from both for backward
  // compatibility.
  var pref1 = Components.classes["@mozilla.org/preferences-service;1"]
                        .getService(Components.interfaces.nsIPrefService)
                        .getBranch("greasemonkey." + startPoint);
  var pref2 = Components.classes["@mozilla.org/preferences-service;1"]
                        .getService(Components.interfaces.nsIPrefService)
                        .getBranch("greasemonkey2." + startPoint);

  var observers = {};
  const nsISupportsString = Components.interfaces.nsISupportsString;

  /**
   * whether a preference exists
   */
  this.exists = function(prefName) {
    return pref2.getPrefType(prefName) != pref2.PREF_INVALID &&
           pref1.getPrefType(prefName) != pref1.PREF_INVALID;
  };

  /**
   * returns the named preference, or defaultValue if it does not exist
   */
  this.getValue = function(prefName, defaultValue) {
    if (pref2.getPrefType(prefName) != pref2.PREF_INVALID) {
      return this.getPref2Value(prefName, defaultValue);
    } else {
      return this.getPref1Value(prefName, defaultValue);
    }
  };

  this.getPref2Value = function(prefName, defaultValue) {
    var storedPref = pref2.getComplexValue(prefName, nsISupportsString).data;
    var match = storedPref.match(/^(\d+) (.*)$/);

    if (match) {
      var typeFlag = parseInt(match[1]);
      var valueString = match[2];

      if (typeFlag == GM_PrefManager.TypeFlag.Boolean) {
        if (valueString == "true") {
          return true;
        } else if (valueString == "false") {
          return false;
        }
      } else if (typeFlag == GM_PrefManager.TypeFlag.Number) {
        var val = parseFloat(valueString);
        // careful to only return successfully for valid numbers
        if (!isNaN(val)) {
          return val;
        }
      } else if (typeFlag == GM_PrefManager.TypeFlag.String) {
        return valueString;
      }
    }

    throw new Error("Unexpected value for prefName '" + prefName + "': '" +
                    storedPref + "'.");
  };

  this.getPref1Value = function(prefName, defaultValue) {
    var prefType = pref1.getPrefType(prefName);

    // underlying preferences object throws an exception if pref doesn't exist
    if (prefType == pref1.PREF_INVALID) {
      return defaultValue;
    }

    switch (prefType) {
      case pref1.PREF_STRING:
        return pref1.getComplexValue(prefName, nsISupportsString).data;
      case pref1.PREF_BOOL:
        return pref1.getBoolPref(prefName);
      case pref1.PREF_INT:
        return pref1.getIntPref(prefName);
    }

    // TODO(aa): Potential backwards compatibility problem?
    throw new Error("Unexpected pref type: " + prefType);
  };

  /**
   * sets the named preference to the specified value. values must be strings,
   * booleans, or integers.
   */
  this.setValue = function(prefName, value) {
    var prefType = typeof(value);
    var typeFlag;

    switch (prefType) {
      case "string":
        typeFlag = GM_PrefManager.TypeFlag.String;
        break;
      case "boolean":
        typeFlag = GM_PrefManager.TypeFlag.Boolean;
        break;
      case "number":
        typeFlag = GM_PrefManager.TypeFlag.Number;
        break;
      default:
        throw new Error("Unsupported type: " + prefType);
    }

    var str = Components.classes["@mozilla.org/supports-string;1"]
                        .createInstance(nsISupportsString);
    str.data = String(typeFlag) + " " + String(value);
    pref2.setComplexValue(prefName, nsISupportsString, str);
  };

  /**
   * deletes the named preference or subtree
   */
  this.remove = function(prefName) {
    pref2.deleteBranch(prefName);
    pref1.deleteBranch(prefName);
  };

  /**
   * call a function whenever the named preference subtree changes
   */
  this.watch = function(prefName, watcher) {
    // construct an observer
    var observer = {
      observe:function(subject, topic, prefName) {
        watcher(prefName);
      }
    };

    // store the observer in case we need to remove it later
    // FIXME: Using a js object this way doesn't even work, the only reason it's
    // working now is because we only ever have one observer in the entire
    // system.
    observers[watcher] = observer;

    pref2.QueryInterface(Components.interfaces.nsIPrefBranchInternal).
      addObserver(prefName, observer, false);
  };

  /**
   * stop watching
   */
  this.unwatch = function(prefName, watcher) {
    if (observers[watcher]) {
      pref2.QueryInterface(Components.interfaces.nsIPrefBranchInternal).
        removeObserver(prefName, observers[watcher]);
    }
  };
};