#!/usr/bin/ruby

class GreasemonkeyScript

	def name
		@name
	end
	def namespace
		@namespace
	end
	def description
		@description
	end
	def includes
		@includes
	end
	def excludes
		@excludes
	end
	def requires
		@requires
	end

	def initialize(path)

		@name = ''
		@namespace = ''
		@description = ''
		@includes = []
		@excludes = []
		@requires = []

		File.open(path, "r") do |infile|
		    while (line = infile.gets)
				@name = line.scan(/@name[\s]+(.*)$/)[0][0].chomp if line =~ /@name[\s]+.*$/
				@namespace = line.scan(/@namespace[\s]+(.*)$/)[0][0].chomp if line =~ /@namespace[\s]+.*$/
				@description = line.scan(/@description[\s]+(.*)$/)[0][0].chomp if line =~ /@description[\s]+.*$/
				@includes.push line.scan(/@include[\s]+(.*)$/)[0][0].chomp if line =~ /@include[\s]+.*$/
				@excludes.push line.scan(/@exclude[\s]+(.*)$/)[0][0].chomp if line =~ /@exclude[\s]+.*$/
				@requires.push line.scan(/@require[\s]+(.*)$/)[0][0].chomp if line =~ /@require[\s]+.*$/
				break if line =~ /\/\/ ==\/UserScript==/
		    end
		end

	end

end

class Array
	def to_json
		if self.length < 1
			'[]'
		else
			'[\'' + self.join('\',\'') + '\']'
		end
	end
end

def FindReplace(path,find,replace)
	file = File.open(path, "r")
	result = ''
	while (line = file.gets)
		result << line
	end
	file.close
	result.gsub! /#{find}/, replace
	file = File.open(path, "w")
	file << result
	file.flush
	file.close
	result
end

`mkdir build`
`mkdir build/content`
`cp chrome.manifest ./build/`
`cp install.rdf ./build/`
`cp browser.js ./build/content/`
`cp browser.xul ./build/content/`
`cp ../license.txt ./build/`
`cp ../chrome/chromeFiles/content/accelimation.js ./build/content/`
`cp ../chrome/chromeFiles/content/config.js ./build/content/`
`cp ../chrome/chromeFiles/content/convert2RegExp.js ./build/content/`
`cp ../chrome/chromeFiles/content/default-config.xml ./build/content/`
`cp ../chrome/chromeFiles/content/menucommander.js ./build/content/`
`cp ../chrome/chromeFiles/content/miscapis.js ./build/content/`
`cp ../chrome/chromeFiles/content/prefmanager.js ./build/content/`
`cp ../chrome/chromeFiles/content/scriptdownloader.js ./build/content/`
`cp ../chrome/chromeFiles/content/utils.js ./build/content/`
`cp ../chrome/chromeFiles/content/versioning.js ./build/content/`
`cp ../chrome/chromeFiles/content/xmlhttprequester.js ./build/content/`

scriptmeta = File.open('./build/content/scriptmeta.js', "w")
scriptmeta << "var XPI_SCRIPTS = [\n"

xpiname = ARGV[4].slice 0, ARGV[4] =~ /\./
name = false
description = false

1.upto ARGV.length - 4 do |i|
	gmscript = ARGV[i+3]
	`cp "#{gmscript}" ./build/content/`
	meta = GreasemonkeyScript.new(gmscript)
	name = meta.name unless name
	description = meta.description unless description
	scriptmeta << "\t{\n"
	scriptmeta << "\t\tenabled: true,\n"
	scriptmeta << "\t\tnamespace: '#{meta.namespace}',\n"
	scriptmeta << "\t\tincludes: #{meta.includes.to_json},\n"
	scriptmeta << "\t\texcludes: #{meta.excludes.to_json},\n"
	scriptmeta << "\t\trequires: #{meta.requires.to_json},\n"
	scriptmeta << "\t\turi: 'chrome://#{xpiname}/content/#{gmscript}'\n"
	scriptmeta << "\t},\n"
end

scriptmeta << "];"
scriptmeta.flush
scriptmeta.close

FindReplace './build/content/browser.xul', 'XPINAME', xpiname
FindReplace './build/content/utils.js', 'chrome://greasemonkey/', "chrome://#{xpiname}/"
FindReplace './build/chrome.manifest', 'XPINAME', xpiname
FindReplace './build/install.rdf', 'NAME', name
FindReplace './build/install.rdf', 'CREATOR', ARGV[0]
FindReplace './build/install.rdf', 'HOMEPAGE', ARGV[1]
FindReplace './build/install.rdf', 'VERSION', ARGV[2]
FindReplace './build/install.rdf', 'GUID', ARGV[3] 
FindReplace './build/install.rdf', 'DESCRIPTION', description

`cd ./build/ && zip -r ../#{xpiname}.xpi * && cd ..`
`rm ./build/ -rf`
