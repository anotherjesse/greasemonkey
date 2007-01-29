#!/bin/sh

rm -rf build
cp install.rdf build/
cp install.js build/
cp -r components build/
cp -r chromeFiles build/
cd build
find * | grep -v 'CVS' | grep -v .DS_Store | zip greasemonkey.xpi -@
mv greasemonkey.xpi ../
