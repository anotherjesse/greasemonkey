#!/bin/sh
#
# NOTE: There could be a lot more customizing in this script, but as it stands, it fixes a wish list item,
#        perhaps more, notated inside the source files, as well as updates the long time ignored install.js - MM -
#
#     : Dependencies:
#         sed
#
#     : All local variables are prefixed with GM to eliminate name collision with other system variables.
#
# NOTE: Set the version here... GMBUILD (the date) should be automatically filled in to match current
#         version syntax later
GMMAX=0
GMMIN=8
GMREL=0

# Default exit value for build status
GMRET=0

# Copy base structure to a temporary build directory and change to it
rm -rf build
mkdir build
cp chrome.manifest build/
cp install.js build/
cp install.rdf build/
cp license.txt build/
cp -r components build/
cp -r chrome build/
cd build

# Generate locales for chrome.manifest from babelzilla directories, which
# we assume have been placed in locale/.
for entry in $(ls chrome/chromeFiles/locale/)
  do
    echo "locale  greasemonkey  "$entry"  chrome/chromeFiles/locale/"$entry"/" >> chrome.manifest
done

# Do some fancy computer footwork to automatically correct versioning
#
# Grab the date
GMBUILD=`date +"%04Y%02m%02d"`

# This is the current GM versioning scheme/style (e.g. 0.8.20071215.0) in extended regular expression form
GMREGEXVER=[0-9]+\.[0-9]+\.[0-9]{8}\.[0-9]+

# Replace the current version with the version variables specified in THIS FILE (build.sh)
#   NOTE: 1) sed doesn't currently have an exit code for number of matches or success/failure
#         2) At the end of this script it will echo what file was created for manual inspection
#         3) Do NOT combine -r and -i parameters as it will produce undesired behavior
#         4) sed didn't like .+ even with extended regular expression switch, so had to resort to .*
#            which is still okay.
sed -r -i "s/<em:version>.*<\/em:version>/<em:version>$GMMAX\.$GMMIN\.$GMBUILD\.$GMREL<\/em:version>/" install.rdf

# Retrieve the current version
#   If previous sed failed, will still have the last manually updated version
GMVER=`grep -Eo '<em:version>.+<\/em:version>' install.rdf | grep -Eo "$GMREGEXVER"`

if [ $GMVER ]; then
  sed -r -i "s/const APP_VERSION =.*;/const APP_VERSION = \"$GMVER\";/" install.js
  find * | grep -v 'CVS' | grep -v '\.svn' | grep -v ~$ | grep -v '#' | grep -v .DS_Store | grep -v MochiKit | zip greasemonkey-$GMVER.xpi -9X -@
  mv greasemonkey-$GMVER.xpi ../../downloads/
else
  GMRET=1
  find * | grep -v 'CVS' | grep -v '\.svn' | grep -v ~$ | grep -v '#' | grep -v .DS_Store | grep -v MochiKit | zip greasemonkey.xpi -9X -@
  mv greasemonkey.xpi ../../downloads/
fi

# Test function to see if GMRET was a success or a problem was detected and notify the user
# This is kept separate for clarity, but may be merged into the respective conditional branches
#   but if there are more status codes down the road, it just makes it clearer to read
if [ $GMRET -eq 0 ]; then
  echo SUCCESS: Created greasemonkey-$GMVER.xpi
else
  echo WARNING: Unable to determine correct version
  echo WARNING: install.rdf and install.js may have invalid version.
  echo SUCCESS: Created greasemonkey.xpi
fi

exit $GMRET