from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    # Пример для docker-compose (сервис БД называется "db"):
    #   postgresql+asyncpg://poyet:poyet@db:5432/poyet
    # Пример для локального Postgres на этой же машине:
    #   postgresql+asyncpg://poyet:poyet@localhost:5432/poyet
    database_url: str = "postgresql+asyncpg://poyet:poyet@localhost:5432/poyet"

    jwt_secret: str = "change-me-in-production"
    jwt_algorithm: str = "HS256"
    jwt_expire_minutes: int = 60 * 24 * 7  # токен живёт 7 дней

    # Список разрешённых источников для CORS через запятую,
    # например: "https://yager-app.example.com,http://localhost:8080"
    cors_origins: str = "*"

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")


settings = Settings()
