"""Persistencia SQLite local para las conversaciones del chatbot."""

import sqlite3
from datetime import datetime, timezone
from pathlib import Path


class ChatStore:
    def __init__(self, database_path: str) -> None:
        self.database_path = Path(database_path)
        self.database_path.parent.mkdir(parents=True, exist_ok=True)
        self._initialize()

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.database_path)
        connection.row_factory = sqlite3.Row
        return connection

    def _initialize(self) -> None:
        with self._connect() as connection:
            connection.executescript(
                """
                CREATE TABLE IF NOT EXISTS chat_conversations (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    title TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS chat_messages (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    conversation_id INTEGER NOT NULL,
                    role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
                    content TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    FOREIGN KEY (conversation_id) REFERENCES chat_conversations(id)
                );
                """
            )

    def create_conversation(self, title: str = "Nueva conversación") -> int:
        now = self._now()
        with self._connect() as connection:
            cursor = connection.execute(
                "INSERT INTO chat_conversations (title, created_at, updated_at) VALUES (?, ?, ?)",
                (title, now, now),
            )
            return int(cursor.lastrowid)

    def list_conversations(self) -> list[dict]:
        with self._connect() as connection:
            rows = connection.execute(
                "SELECT id, title, created_at, updated_at FROM chat_conversations "
                "ORDER BY updated_at DESC, id DESC"
            ).fetchall()
        return [dict(row) for row in rows]

    def get_messages(self, conversation_id: int) -> list[dict]:
        with self._connect() as connection:
            rows = connection.execute(
                "SELECT role, content, created_at FROM chat_messages "
                "WHERE conversation_id = ? ORDER BY id ASC",
                (conversation_id,),
            ).fetchall()
        return [dict(row) for row in rows]

    def add_message(self, conversation_id: int, role: str, content: str) -> None:
        if role not in {"user", "assistant"}:
            raise ValueError("Rol de chat inválido")
        now = self._now()
        with self._connect() as connection:
            connection.execute(
                "INSERT INTO chat_messages (conversation_id, role, content, created_at) "
                "VALUES (?, ?, ?, ?)",
                (conversation_id, role, content, now),
            )
            connection.execute(
                "UPDATE chat_conversations SET updated_at = ? WHERE id = ?",
                (now, conversation_id),
            )

    def update_title(self, conversation_id: int, title: str) -> None:
        with self._connect() as connection:
            connection.execute(
                "UPDATE chat_conversations SET title = ?, updated_at = ? WHERE id = ?",
                (title, self._now(), conversation_id),
            )

    @staticmethod
    def _now() -> str:
        return datetime.now(timezone.utc).isoformat()
