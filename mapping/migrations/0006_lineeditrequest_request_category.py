from django.db import migrations, models


def backfill_request_category(apps, schema_editor):
    LineEditRequest = apps.get_model("mapping", "LineEditRequest")
    RiyadhRoad = apps.get_model("mapping", "RiyadhRoad")

    roads_by_id = {}
    try:
        roads_by_id = {
            int(road.gid): road
            for road in RiyadhRoad.objects.using("riyadh_roads").all().only("gid", "name", "fclass")
        }
    except Exception:
        pass

    for req in LineEditRequest.objects.all().iterator():
        if req.request_category:
            continue
        road = (
            roads_by_id.get(int(req.riyadh_road_id))
            if req.is_riyadh_road and req.riyadh_road_id is not None
            else None
        )
        key = _classify_for_migration(req, road)
        LineEditRequest.objects.filter(pk=req.pk).update(request_category=key)


def _classify_for_migration(req, road):
    """Minimal classifier for migration (no import of full app helpers)."""
    edit_type = (req.edit_type or "").upper()
    if edit_type == "LAYER UPLOAD" or req.layer_upload_feature_id:
        return "layer_upload"
    if edit_type == "DELETE":
        return "delete_road"
    if not req.is_riyadh_road or req.riyadh_road_id is None:
        return "new_road"

    fields = req.fields_data if isinstance(req.fields_data, dict) else {}
    orig_name = (fields.get("_original_road_name") or getattr(road, "name", "") or "").strip()
    prop_name = (fields.get("name") or "").strip()
    if prop_name and not orig_name:
        return "add_road_label"
    if orig_name and prop_name and orig_name != prop_name:
        return "change_road_label"
    if req.geometry_changed:
        return "new_road_geometry"
    prop_label = (req.current_feature_label or "").strip()
    orig_label = (fields.get("_original_feature_label") or "").strip()
    if road and not orig_label:
        fclass = getattr(road, "fclass", None) or ""
        orig_label = fclass.replace("_", " ").title() if fclass else ""
    if orig_label != prop_label:
        return "new_feature_type"
    return "road_attribute_edit"


class Migration(migrations.Migration):
    dependencies = [
        ("mapping", "0005_remove_lineeditrequest_parent_approved_line_id"),
    ]

    operations = [
        migrations.AddField(
            model_name="lineeditrequest",
            name="request_category",
            field=models.CharField(
                blank=True,
                default="",
                help_text="Primary approval category key (manager queue filter/display).",
                max_length=32,
            ),
        ),
        migrations.RunPython(backfill_request_category, migrations.RunPython.noop),
    ]
