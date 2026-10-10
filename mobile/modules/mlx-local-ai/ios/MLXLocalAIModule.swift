import ExpoModulesCore
import Foundation
import FoundationModels

public final class MLXLocalAI: Module {
  private static let instructions = """
  Eres el asistente local de una aplicación MLX90614. Responde siempre en español,
  de forma breve y clara. Usa únicamente el contexto de mediciones que entrega la
  aplicación. No inventes valores ni afirmes que consultaste Internet o un servidor.
  Las clasificaciones de temperatura son reglas de la aplicación, no diagnósticos.
  """

  public func definition() -> ModuleDefinition {
    Name("MLXLocalAI")

    AsyncFunction("availability") { () async -> [String: String] in
      return Self.availability()
    }

    AsyncFunction("answer") { (question: String, context: String) async -> String in
      return await Self.answer(question: question, context: context, instructions: Self.instructions)
    }
  }

  private static func availability() -> [String: String] {
    guard #available(iOS 26.0, *) else {
      return ["status": "unavailable", "reason": "Requiere iOS 26 o posterior."]
    }

    let model = SystemLanguageModel.default
    switch model.availability {
    case .available:
      return ["status": "available", "reason": ""]
    case .unavailable(let reason):
      return ["status": "unavailable", "reason": Self.unavailableReason(reason)]
    }
  }

  private static func answer(question: String, context: String, instructions: String) async -> String {
    guard #available(iOS 26.0, *) else {
      return "Apple Intelligence requiere iOS 26 o posterior. Puedes consultar el resumen local mostrado en la aplicación."
    }

    let model = SystemLanguageModel.default
    guard case .available = model.availability else {
      return "Apple Intelligence no está disponible en este iPhone. Actívalo y espera a que el modelo termine de descargarse en Ajustes."
    }

    do {
      let session = LanguageModelSession(model: model, instructions: instructions)
      let prompt = "Contexto local de SQLite:\n\(context)\n\nPregunta: \(question)"
      let response = try await session.respond(to: prompt)
      return response.content
    } catch {
      return "No pude generar una respuesta local ahora. Revisa las métricas y el historial guardados en este iPhone."
    }
  }

  @available(iOS 26.0, *)
  private static func unavailableReason(_ reason: SystemLanguageModel.Availability.UnavailableReason) -> String {
    switch reason {
    case .deviceNotEligible:
      return "Este iPhone no es compatible con Apple Intelligence."
    case .appleIntelligenceNotEnabled:
      return "Activa Apple Intelligence en Ajustes."
    case .modelNotReady:
      return "El modelo local todavía se está descargando o preparando."
    @unknown default:
      return "El modelo local no está disponible."
    }
  }
}
