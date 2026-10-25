# Konzistentní záloha AI databáze

`app/operations.py` je modul pro stávající soukromou AI službu. `app/store.py` je odpovídající datové rozhraní pro reprodukovatelný test obnovy. Nejde o celý samostatný serverový balíček; konfigurace události, prompty, hesla, `.env` a OAuth tokeny nejsou součástí veřejného repozitáře.

Do existujícího `worker.py` se přidává import `from .operations import synchronize as synchronize_operations`. Na konci každého průchodu smyčky před čekáním se zavolá `synchronize_operations(self.store)` ve vlastním try/except; chyba uloží `ops_error=OPS_BACKUP_FAILED` a neukončí zpracování Gmailu. Konkrétní nasazovaný pracovní soubor a jeho záloha jsou uchovány soukromě spolu s manifestem verzí.

Modul používá stávající `ADMIN_BRIDGE_SECRET`, pevnou adresu `/api/ops`, vlastní podpisový namespace a oddělený zdroj assistant. První úspěšná denní záloha se uchová v D1. SQLite Backup API zahrnuje potvrzený WAL; z kopie se bezpečně odstraní aktivní OAuth relace a provede se VACUUM. Soubor `token.json`, klíče a hesla se neexportují. Pro jejich obnovu je nutné opětovné přihlášení nebo oddělená bezpečná správa tajných údajů.

Test `tests/test_operations.py` skutečně obnovuje SQLite do izolované databáze, kontroluje integritu, potvrzené WAL záznamy a nepřítomnost OAuth verifieru. Neposílá e-maily ani skutečné síťové požadavky.
