"""
Manage tile API tokens and tile layers.

    python manage.py tile_tokens create --name "QGIS - Ops team" --layers riyadh_roads --days 90
    python manage.py tile_tokens list [--all]
    python manage.py tile_tokens revoke <id-or-prefix>
    python manage.py tile_tokens usage [--days 30]
    python manage.py tile_tokens layers
    python manage.py tile_tokens add-layer <martin_source_id> --name "Display name" [--no-session]
    python manage.py tile_tokens set-layer riyadh_roads --no-anonymous   # require token/session
"""
from argparse import BooleanOptionalAction
from datetime import timedelta

from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError
from django.core.management.base import BaseCommand, CommandError
from django.db.models import Sum
from django.utils import timezone

from tile_access.models import TileAccessToken, TileLayer, TileUsageDaily


class Command(BaseCommand):
    help = "Create, list, and revoke tile API tokens; show usage; manage tile layers."

    def add_arguments(self, parser):
        sub = parser.add_subparsers(dest="action", required=True)

        create = sub.add_parser("create", help="Issue a new token (printed once).")
        create.add_argument("--name", required=True)
        create.add_argument("--layers", required=True, help="Comma-separated layer slugs, e.g. riyadh_roads")
        create.add_argument("--days", type=int, default=None, help="Expire after N days (default: never)")
        create.add_argument("--created-by", default=None, help="Username/email of the issuing admin")
        create.add_argument("--notes", default="")

        listing = sub.add_parser("list", help="List tokens.")
        listing.add_argument("--all", action="store_true", help="Include revoked and expired tokens")

        revoke = sub.add_parser("revoke", help="Revoke a token (takes effect on the next tile).")
        revoke.add_argument("token", help="Token id or its public prefix (gtk_xxxxxxxx)")

        usage = sub.add_parser("usage", help="Tile request counts.")
        usage.add_argument("--days", type=int, default=30)

        sub.add_parser("layers", help="List tile layers.")

        add_layer = sub.add_parser("add-layer", help="Register another Martin source.")
        add_layer.add_argument("slug")
        add_layer.add_argument("--name", required=True)
        add_layer.add_argument("--description", default="")
        add_layer.add_argument("--no-session", action="store_true", help="Token-only (hide from web map sessions)")

        set_layer = sub.add_parser("set-layer", help="Change a tile layer's access flags.")
        set_layer.add_argument("slug")
        set_layer.add_argument("--active", action=BooleanOptionalAction, default=None)
        set_layer.add_argument("--session", action=BooleanOptionalAction, default=None,
                               help="Allow signed-in GeoTrak users")
        set_layer.add_argument("--anonymous", action=BooleanOptionalAction, default=None,
                               help="Allow requests without token or session")

    def handle(self, *args, **opts):
        handler = getattr(self, "_" + opts["action"].replace("-", "_"))
        handler(opts)

    # ------------------------------------------------------------------ actions
    def _create(self, opts):
        slugs = [s.strip() for s in opts["layers"].split(",") if s.strip()]
        layers = list(TileLayer.objects.filter(slug__in=slugs))
        missing = sorted(set(slugs) - {layer.slug for layer in layers})
        if missing:
            raise CommandError(f"Unknown layer(s): {', '.join(missing)}. See: tile_tokens layers")

        created_by = None
        if opts["created_by"]:
            user_model = get_user_model()
            created_by = (
                user_model.objects.filter(username=opts["created_by"]).first()
                or user_model.objects.filter(email__iexact=opts["created_by"]).first()
            )
            if created_by is None:
                raise CommandError(f"No user '{opts['created_by']}'.")

        expires_at = timezone.now() + timedelta(days=opts["days"]) if opts["days"] else None
        token, raw = TileAccessToken.issue(
            name=opts["name"],
            layers=layers,
            created_by=created_by,
            expires_at=expires_at,
            notes=opts["notes"],
        )

        self.stdout.write(self.style.SUCCESS(f"Created token #{token.pk} '{token.name}'"))
        self.stdout.write(f"  layers : {', '.join(l.slug for l in layers)}")
        self.stdout.write(f"  expires: {expires_at.isoformat() if expires_at else 'never'}")
        self.stdout.write("")
        self.stdout.write(self.style.WARNING("Copy the token now. It cannot be shown again:"))
        self.stdout.write(f"  {raw}")
        self.stdout.write("")
        for layer in layers:
            self.stdout.write(f"  XYZ: http://<geotrak-host>:8000/tiles/{layer.slug}/{{z}}/{{x}}/{{y}}?token={raw}")

    def _list(self, opts):
        qs = TileAccessToken.objects.prefetch_related("layers").order_by("-created_at")
        rows = [t for t in qs if opts["all"] or t.is_active]
        if not rows:
            self.stdout.write("No tokens.")
            return
        for t in rows:
            state = "revoked" if t.is_revoked else "expired" if t.is_expired else "active"
            self.stdout.write(
                f"#{t.pk:<4} {t.token_prefix:<14} {state:<8} {t.name:<30} "
                f"layers={','.join(l.slug for l in t.layers.all()) or '-'} "
                f"expires={t.expires_at.date() if t.expires_at else 'never'} "
                f"last_used={t.last_used_at.isoformat(timespec='minutes') if t.last_used_at else 'never'}"
            )

    def _revoke(self, opts):
        ref = opts["token"].strip()
        if ref.isdigit():
            matches = list(TileAccessToken.objects.filter(pk=int(ref)))
        else:
            matches = list(TileAccessToken.objects.filter(token_prefix__startswith=ref))
        if not matches:
            raise CommandError(f"No token matches '{ref}'.")
        if len(matches) > 1:
            raise CommandError(f"'{ref}' matches {len(matches)} tokens; use the numeric id.")
        token = matches[0]
        token.revoke()
        self.stdout.write(self.style.SUCCESS(f"Revoked #{token.pk} '{token.name}' ({token.token_prefix})."))

    def _usage(self, opts):
        since = timezone.localdate() - timedelta(days=opts["days"])
        qs = (
            TileUsageDaily.objects.filter(date__gte=since)
            .values("layer__slug", "token__token_prefix", "token__name", "user__username")
            .annotate(total=Sum("request_count"))
            .order_by("-total")
        )
        if not qs:
            self.stdout.write(f"No tile usage since {since}.")
            return
        self.stdout.write(f"Tile requests since {since}:")
        for row in qs:
            who = (
                f"token {row['token__token_prefix']} ({row['token__name']})"
                if row["token__token_prefix"]
                else f"user {row['user__username']}"
            )
            self.stdout.write(f"  {row['total']:>10}  {row['layer__slug']:<20} {who}")

    def _layers(self, opts):
        for layer in TileLayer.objects.all():
            flags = []
            if not layer.is_active:
                flags.append("INACTIVE")
            flags.append("session" if layer.allow_session_access else "no-session")
            if layer.allow_anonymous_access:
                flags.append("ANONYMOUS(public)")
            self.stdout.write(f"{layer.slug:<24} {layer.name:<30} {' '.join(flags)}")

    def _set_layer(self, opts):
        layer = TileLayer.objects.filter(slug=opts["slug"]).first()
        if layer is None:
            raise CommandError(f"No tile layer '{opts['slug']}'.")
        changes = {
            "is_active": opts["active"],
            "allow_session_access": opts["session"],
            "allow_anonymous_access": opts["anonymous"],
        }
        changes = {field: value for field, value in changes.items() if value is not None}
        if not changes:
            raise CommandError("Nothing to change. Use --[no-]active, --[no-]session, --[no-]anonymous.")
        for field, value in changes.items():
            setattr(layer, field, value)
        layer.save(update_fields=list(changes))
        self.stdout.write(self.style.SUCCESS(f"Updated '{layer.slug}': {changes}"))

    def _add_layer(self, opts):
        layer = TileLayer(
            slug=opts["slug"],
            name=opts["name"],
            description=opts["description"],
            allow_session_access=not opts["no_session"],
        )
        try:
            layer.full_clean()
        except ValidationError as exc:
            raise CommandError(exc.message_dict)
        layer.save()
        self.stdout.write(self.style.SUCCESS(f"Added tile layer '{layer.slug}'."))
