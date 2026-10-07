"""Chatbot local Streamlit con DeepSeek y consultas seguras de temperatura."""

import json
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import requests
import streamlit as st
from dotenv import load_dotenv
from openai import OpenAI

from chat_store import ChatStore


SYSTEM_PROMPT = """Eres un asistente de monitoreo para un sensor MLX90614.
Los datos históricos son resúmenes por minuto UTC de la tabla temperature_minutes.
Cada fila contiene samples y las estadísticas ambient_min, ambient_max, ambient_avg,
object_min, object_max y object_avg. Los promedios de periodos deben estar ponderados
por samples. Las preguntas sin zona horaria se interpretan en America/Lima.
Usa las herramientas para obtener datos antes de afirmar cifras. No inventes mediciones.
La clasificación frio/templado/calido/caluroso es una regla de aplicación, no una medida
científica de sensación térmica. Responde de forma clara en español."""

TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "get_temperature_stats",
            "description": "Obtiene min, max, promedio ponderado, muestras y clasificación para un periodo.",
            "parameters": {
                "type": "object",
                "properties": {
                    "start": {"type": "string", "description": "Inicio ISO 8601 en hora local de Lima si no incluye zona."},
                    "end": {"type": "string", "description": "Fin ISO 8601 exclusivo en hora local de Lima si no incluye zona."},
                },
                "required": ["start", "end"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_latest_temperature",
            "description": "Obtiene el último resumen por minuto disponible.",
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_temperature_history",
            "description": "Obtiene filas históricas por minuto para un rango acotado.",
            "parameters": {
                "type": "object",
                "properties": {
                    "start": {"type": "string", "description": "Inicio ISO 8601."},
                    "end": {"type": "string", "description": "Fin ISO 8601 exclusivo."},
                    "limit": {"type": "integer", "minimum": 1, "maximum": 5000},
                },
                "required": ["start", "end"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_daily_summary",
            "description": "Obtiene el resumen ponderado de un día local.",
            "parameters": {
                "type": "object",
                "properties": {"date": {"type": "string", "description": "Fecha local YYYY-MM-DD."}},
                "required": ["date"],
            },
        },
    },
]


@dataclass(frozen=True)
class ChatbotSettings:
    deepseek_api_key: str
    deepseek_model: str
    temperature_api_base_url: str
    chat_database_path: str


def required_env(name: str) -> str:
    value = os.getenv(name)
    if value is None or not value.strip():
        raise ValueError(f"Falta {name} en .env.chatbot")
    return value.strip()


def load_settings() -> ChatbotSettings:
    load_dotenv(Path(__file__).with_name(".env.chatbot"))
    return ChatbotSettings(
        deepseek_api_key=required_env("DEEPSEEK_API_KEY"),
        deepseek_model=required_env("DEEPSEEK_MODEL"),
        temperature_api_base_url=required_env("TEMPERATURE_API_BASE_URL").rstrip("/"),
        chat_database_path=required_env("CHAT_DATABASE_PATH"),
    )


def execute_temperature_tool(base_url: str, name: str, arguments: dict[str, Any]) -> dict[str, Any]:
    routes = {
        "get_temperature_stats": "/temperature/stats",
        "get_latest_temperature": "/temperature/latest",
        "get_temperature_history": "/temperature/history",
        "get_daily_summary": "/temperature/daily-summary",
    }
    route = routes.get(name)
    if route is None:
        return {"error": "Herramienta no permitida"}
    try:
        response = requests.get(f"{base_url}{route}", params=arguments, timeout=15)
        response.raise_for_status()
        return response.json()
    except requests.RequestException as error:
        return {"error": "No se pudo consultar la API de temperatura", "detail": str(error)}
    except ValueError:
        return {"error": "La API de temperatura devolvió una respuesta inválida"}


def answer_question(settings: ChatbotSettings, history: list[dict], question: str) -> str:
    client = OpenAI(api_key=settings.deepseek_api_key, base_url="https://api.deepseek.com")
    messages: list[dict[str, Any]] = [{"role": "system", "content": SYSTEM_PROMPT}]
    messages.extend({"role": item["role"], "content": item["content"]} for item in history)
    messages.append({"role": "user", "content": question})

    for _ in range(5):
        response = client.chat.completions.create(
            model=settings.deepseek_model,
            messages=messages,
            tools=TOOLS,
            tool_choice="auto",
            temperature=0.2,
        )
        assistant_message = response.choices[0].message
        if not assistant_message.tool_calls:
            return assistant_message.content or "No pude generar una respuesta."

        messages.append(assistant_message.model_dump(exclude_none=True))
        for tool_call in assistant_message.tool_calls:
            try:
                arguments = json.loads(tool_call.function.arguments)
            except json.JSONDecodeError:
                tool_result = {"error": "Argumentos de herramienta inválidos"}
            else:
                tool_result = execute_temperature_tool(
                    settings.temperature_api_base_url,
                    tool_call.function.name,
                    arguments,
                )
            messages.append(
                {
                    "role": "tool",
                    "tool_call_id": tool_call.id,
                    "content": json.dumps(tool_result, ensure_ascii=False),
                }
            )
    return "No pude completar la consulta de datos tras varios intentos."


def select_conversation(store: ChatStore) -> int:
    conversations = store.list_conversations()
    if not conversations:
        return store.create_conversation()
    choices = {f"{item['id']} · {item['title']}": item["id"] for item in conversations}
    selected = st.sidebar.selectbox("Conversación", list(choices), key="conversation_selector")
    return choices[selected]


def main() -> None:
    st.set_page_config(page_title="MLX90614 Chat", page_icon="💬", layout="wide")
    st.title("MLX90614 Chat")
    st.caption("Consultas de temperatura con DeepSeek y la API histórica segura.")

    try:
        settings = load_settings()
    except ValueError as error:
        st.error(str(error))
        st.stop()

    store = ChatStore(settings.chat_database_path)
    if st.sidebar.button("Nueva conversación"):
        new_id = store.create_conversation()
        st.session_state["conversation_selector"] = f"{new_id} · Nueva conversación"
        st.rerun()

    conversation_id = select_conversation(store)
    history = store.get_messages(conversation_id)
    for item in history:
        with st.chat_message(item["role"]):
            st.markdown(item["content"])

    question = st.chat_input("Pregunta sobre las temperaturas")
    if not question:
        return

    with st.chat_message("user"):
        st.markdown(question)
    store.add_message(conversation_id, "user", question)
    if len(history) == 0:
        store.update_title(conversation_id, question[:60])

    with st.chat_message("assistant"):
        with st.spinner("Consultando datos..."):
            try:
                answer = answer_question(settings, history, question)
            except Exception:
                answer = "No se pudo consultar DeepSeek en este momento."
        st.markdown(answer)
    store.add_message(conversation_id, "assistant", answer)


if __name__ == "__main__":
    main()
