require "json"

package = JSON.parse(File.read(File.join(__dir__, "package.json")))

Pod::Spec.new do |s|
  s.name = "mlx-local-ai"
  s.version = package["version"]
  s.summary = package["description"]
  s.homepage = "https://example.invalid/mlx-local-ai"
  s.authors = { "MLX90614 Local" => "local@example.invalid" }
  s.license = { :type => "MIT" }
  s.platforms = { :ios => "16.4" }
  s.source = { :git => "https://example.invalid/mlx-local-ai.git", :tag => s.version.to_s }
  s.source_files = "ios/**/*.{h,m,mm,swift}"
  s.dependency "ExpoModulesCore"
  s.weak_framework = "FoundationModels"
  s.swift_version = "6.0"
end
