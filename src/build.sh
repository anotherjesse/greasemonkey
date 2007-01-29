#!/bin/sh

rm -rf build
mkdir -p build/chrome/greasemonkey
cp install.rdf build/
cp install.js build/
cp -r components build/
cp -r content build/chrome/greasemonkey/
cd build
find * | grep -v 'CVS' | grep -v .DS_Store | zip greasemonkey.xpi -@
mv greasemonkey.xpi ../
