from typing import Optional


class RiyadhRoadsRouter:
    def db_for_read(self, model, **hints) -> Optional[str]:
        if model._meta.app_label == "mapping" and model.__name__ == "RiyadhRoad":
            return "riyadh_roads"
        return None

    def db_for_write(self, model, **hints) -> Optional[str]:
        if model._meta.app_label == "mapping" and model.__name__ == "RiyadhRoad":
            return "riyadh_roads"
        return None

    def allow_relation(self, obj1, obj2, **hints) -> Optional[bool]:
        return None

    def allow_migrate(self, db, app_label, model_name=None, **hints) -> Optional[bool]:
        if app_label == "mapping" and model_name == "riyadhroad":
            return db == "riyadh_roads"
        return None

