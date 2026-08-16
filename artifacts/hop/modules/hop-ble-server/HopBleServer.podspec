require 'json'

package = JSON.parse(File.read(File.join(__dir__, 'package.json')))

Pod::Spec.new do |s|
  s.name           = 'HopBleServer'
  s.version        = package['version']
  s.summary        = package['description']
  s.license        = package['license']
  s.homepage       = 'https://github.com/jaydaexx-oss/hop'
  s.authors        = 'HOP'
  s.source         = { git: '' }
  s.platforms      = { ios: '13.4' }
  s.swift_version  = '5.4'

  s.dependency 'ExpoModulesCore'

  # Swift and Objective-C source files
  s.source_files = 'ios/**/*.{h,m,swift}'
end
