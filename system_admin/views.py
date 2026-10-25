from datetime import datetime
from django.shortcuts import render, redirect
from django.contrib import messages
from django.contrib.auth.decorators import login_required
from django.contrib.auth import logout
from django.urls import reverse
from django.contrib.auth.models import User
from django.core.validators import validate_email
from django.core.exceptions import ValidationError
from django.http import JsonResponse
from django.db.models import F
from .account import render_account_page
from .models import UserProfile
from mapping.presentation import enforce_my_edits_access, my_edits_page_context


def _manageable_user(user_id, action_label):
    """Return a non-admin user and profile, or an error message."""
    try:
        user = User.objects.get(pk=user_id)
    except (User.DoesNotExist, TypeError, ValueError):
        return None, None, 'User not found.'
    if user.is_superuser:
        return None, None, f'System Admin accounts cannot be {action_label} through this page.'
    profile, _ = UserProfile.objects.get_or_create(user=user)
    return user, profile, None


@login_required(login_url='/login/')
def map_view(request):
    """System Admin Map view - landing page after login."""
    if not request.user.is_superuser:
        logout(request)
        return redirect(f"{reverse('auth:login')}?session_ended=1")
    return render(request, "system_admin/map.html")


@login_required(login_url='/login/')
def account_information_view(request):
    """Account Information view."""
    if not request.user.is_superuser:
        logout(request)
        return redirect(f"{reverse('auth:login')}?session_ended=1")
    return render_account_page(request, 'admin', 'system_admin/account_information.html')


@login_required(login_url='/login/')
def security_view(request):
    """Security view."""
    # Only superusers (system admins) can access this view.
    if not request.user.is_superuser:
        logout(request)
        return redirect(f"{reverse('auth:login')}?session_ended=1")

    context = {}

    if request.method == "POST":
        intent = request.POST.get("intent")

        if intent == "change_password":
            errors = []
            current_password = request.POST.get('current_password', '').strip()
            new_password = request.POST.get('new_password', '').strip()
            confirm_password = request.POST.get('confirm_password', '').strip()

            if not current_password or not new_password or not confirm_password:
                errors.append('All password fields are required.')

            if current_password and not request.user.check_password(current_password):
                errors.append('Current password is incorrect.')

            if new_password and len(new_password) < 8:
                errors.append('New password must be at least 8 characters long.')

            if new_password and confirm_password and new_password != confirm_password:
                errors.append('New passwords do not match.')

            if not errors:
                user = request.user
                user.set_password(new_password)
                user.save()
                logout(request)
                return redirect('/login/?password_changed=1')
            else:
                for err in errors:
                    messages.error(request, err)

    return render(request, "system_admin/security.html", context)


@login_required(login_url='/login/')
def users_view(request):
    """Users view."""
    # Only superusers (system admins) can access this view.
    if not request.user.is_superuser:
        logout(request)
        return redirect(f"{reverse('auth:login')}?session_ended=1")
    
    from django.utils import timezone
    
    # High-level user statistics.
    all_users_count = User.objects.count()
    active_users_count = User.objects.filter(is_active=True).count()
    
    # Count users created in the current calendar month.
    now = timezone.now()
    start_of_month = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    users_this_month = User.objects.filter(date_joined__gte=start_of_month).count()

    def _display_role(user):
        if user.is_superuser:
            return 'Administrator'
        profile = getattr(user, 'profile', None)
        if profile and profile.role == 'editor':
            return 'Editor'
        if profile and profile.role == 'manager':
            return 'Manager'
        return 'Viewer'

    recent_users = []
    recent_qs = (
        User.objects.select_related('profile')
        .order_by(F('last_login').desc(nulls_last=True), '-date_joined')[:50]
    )
    for user in recent_qs:
        profile = getattr(user, 'profile', None)
        full_name = user.get_full_name() or user.username
        recent_users.append({
            'id': user.id,
            'full_name': full_name,
            'email': user.email,
            'role': _display_role(user),
            'is_active': user.is_active,
            'last_login': user.last_login,
            'initial': (full_name or user.email or '?')[:1].upper(),
            'profile_image': profile.profile_image.url if profile and profile.profile_image else '',
        })
    
    context = {
        'all_users_count': all_users_count,
        'active_users_count': active_users_count,
        'users_this_month': users_this_month,
        'recent_users': recent_users,
    }
    
    return render(request, 'system_admin/users.html', context)


@login_required(login_url='/login/')
def add_user_view(request):
    """Add User view."""
    # Only superusers (system admins) can create new users.
    if not request.user.is_superuser:
        logout(request)
        return redirect(f"{reverse('auth:login')}?session_ended=1")
    
    context = {}
    
    if request.method == 'POST':
        intent = request.POST.get('intent')
        if intent == 'add_user':
            errors = []
            full_name = request.POST.get('full_name', '').strip()
            email = request.POST.get('email', '').strip()
            password = request.POST.get('password', '').strip()
            confirm_password = request.POST.get('confirm_password', '').strip()
            role = request.POST.get('role', '').strip()
            
            if not full_name:
                errors.append('Full name is required.')
            
            if not email:
                errors.append('Email is required.')
            else:
                try:
                    validate_email(email)
                except ValidationError:
                    errors.append('Please provide a valid email.')
                else:
                    if User.objects.filter(username=email).exists():
                        errors.append('A user with this email already exists.')
            
            if not password:
                errors.append('Password is required.')
            elif len(password) < 8:
                errors.append('Password must be at least 8 characters long.')
            
            if password != confirm_password:
                errors.append('Passwords do not match.')
            
            if not role:
                errors.append('Role is required.')
            elif role not in ['manager', 'editor']:
                errors.append('Invalid role selected.')
            
            if not errors:
                # For managers, read the selected permission flags.
                if role == 'manager':
                    can_access_dashboard = request.POST.get('can_access_dashboard') == 'on'
                    can_access_security = request.POST.get('can_access_security') == 'on'
                    can_access_account_information = request.POST.get('can_access_account_information') == 'on'
                    can_access_layer_uploader = request.POST.get('can_access_layer_uploader') == 'on'
                    can_access_my_edits = request.POST.get('can_access_my_edits') == 'on'
                # For editors, read the selected permission flags.
                elif role == 'editor':
                    can_access_dashboard = False  # Editors never receive dashboard access.
                    can_access_security = request.POST.get('can_access_security') == 'on'
                    can_access_account_information = request.POST.get('can_access_account_information') == 'on'
                    can_access_layer_uploader = request.POST.get('can_access_layer_uploader') == 'on'
                    can_access_my_edits = request.POST.get('can_access_my_edits') == 'on'
                else:
                    can_access_dashboard = False
                    can_access_security = False
                    can_access_account_information = False
                    can_access_layer_uploader = False
                    can_access_my_edits = False
                
                # Create the base Django user.
                user = User.objects.create_user(
                    username=email,
                    email=email,
                    password=password,
                    first_name=full_name.split()[0] if full_name.split() else '',
                    last_name=' '.join(full_name.split()[1:]) if len(full_name.split()) > 1 else '',
                    is_active=True
                )
                
                # Attach a profile capturing role, permissions, and creation timestamp.
                profile = UserProfile.objects.create(
                    user=user,
                    role=role,
                    can_access_dashboard=can_access_dashboard,
                    can_access_security=can_access_security,
                    can_access_account_information=can_access_account_information,
                    can_access_layer_uploader=can_access_layer_uploader,
                    can_access_my_edits=can_access_my_edits,
                )
                profile.set_account_creation_datetime()
                
                messages.success(
                    request,
                    f"User {full_name} has been added successfully as {role.title()}.",
                )
            else:
                for err in errors:
                    messages.error(request, err)
    
    return render(request, 'system_admin/add_user.html', context)


@login_required(login_url='/login/')
def edit_user_view(request, user_id=None):
    """Edit User view."""
    if not request.user.is_superuser:
        logout(request)
        return redirect(f"{reverse('auth:login')}?session_ended=1")

    context = {}

    if request.method != 'POST':
        if user_id:
            user_to_edit, profile, error = _manageable_user(user_id, 'edited')
            if error:
                messages.warning(request, error)
            else:
                context['user_to_edit'] = user_to_edit
                context['user_profile'] = profile
        return render(request, 'system_admin/edit_user.html', context)

    intent = request.POST.get('intent')

    if intent == 'search_user':
        email = request.POST.get('search_email', '').strip()
        if not email:
            messages.error(request, 'Email is required to search for a user.')
            return render(request, 'system_admin/edit_user.html', context)

        try:
            user_to_edit = User.objects.get(username=email)
        except User.DoesNotExist:
            messages.error(request, 'User with this email does not exist.')
            return render(request, 'system_admin/edit_user.html', context)

        if user_to_edit.is_superuser:
            messages.warning(
                request,
                'System Admin accounts cannot be edited through this page.',
            )
            return render(request, 'system_admin/edit_user.html', context)

        profile, _ = UserProfile.objects.get_or_create(user=user_to_edit)
        context['user_to_edit'] = user_to_edit
        context['user_profile'] = profile

    elif intent == 'update_user':
        user_id = request.POST.get('user_id')
        if not user_id:
            messages.error(request, 'User ID is required.')
            return render(request, 'system_admin/edit_user.html', context)

        try:
            user_to_edit = User.objects.get(pk=user_id)
        except User.DoesNotExist:
            messages.error(request, 'User not found.')
            return render(request, 'system_admin/edit_user.html', context)

        if user_to_edit.is_superuser:
            messages.error(request, 'System Admin accounts cannot be edited.')
            return render(request, 'system_admin/edit_user.html', context)

        errors = []
        full_name = request.POST.get('full_name', '').strip()
        email = request.POST.get('email', '').strip()
        account_status = request.POST.get('account_status', '').strip()

        if not full_name:
            errors.append('Full name is required.')

        if not email:
            errors.append('Email is required.')
        else:
            try:
                validate_email(email)
            except ValidationError:
                errors.append('Please provide a valid email.')
            else:
                if User.objects.filter(username=email).exclude(pk=user_to_edit.pk).exists():
                    errors.append('A user with this email already exists.')

        if account_status not in ['active', 'inactive']:
            errors.append('Invalid account status selected.')

        if not errors:
            name_parts = full_name.split()
            user_to_edit.first_name = name_parts[0] if name_parts else ''
            user_to_edit.last_name = ' '.join(name_parts[1:]) if len(name_parts) > 1 else ''
            user_to_edit.email = email
            user_to_edit.username = email
            user_to_edit.is_active = account_status == 'active'
            user_to_edit.save()
            messages.success(request, f'User {full_name} has been updated successfully.')
        else:
            for err in errors:
                messages.error(request, err)

        profile, _ = UserProfile.objects.get_or_create(user=user_to_edit)
        context['user_to_edit'] = user_to_edit
        context['user_profile'] = profile

    return render(request, 'system_admin/edit_user.html', context)


@login_required(login_url='/login/')
def delete_user_view(request, user_id=None):
    """Delete User view."""
    if not request.user.is_superuser:
        logout(request)
        return redirect(f"{reverse('auth:login')}?session_ended=1")

    context = {}

    if request.method != 'POST':
        if user_id:
            user_to_delete, profile, error = _manageable_user(user_id, 'deleted')
            if error:
                messages.warning(request, error)
            else:
                context['user_to_delete'] = user_to_delete
                context['user_profile'] = profile
        return render(request, 'system_admin/delete_user.html', context)

    intent = request.POST.get('intent')

    if intent == 'search_user':
        email = request.POST.get('search_email', '').strip()
        if not email:
            messages.error(request, 'Email is required to search for a user.')
        else:
            try:
                user_to_delete = User.objects.get(username=email)
            except User.DoesNotExist:
                messages.error(request, 'User with this email does not exist.')
            else:
                if user_to_delete.is_superuser:
                    messages.warning(
                        request,
                        'System Admin accounts cannot be deleted through this page.',
                    )
                else:
                    profile, _ = UserProfile.objects.get_or_create(user=user_to_delete)
                    context['user_to_delete'] = user_to_delete
                    context['user_profile'] = profile

    elif intent == 'delete_user':
        posted_user_id = request.POST.get('user_id')
        if not posted_user_id:
            messages.error(request, 'User ID is required.')
        else:
            try:
                user_to_delete = User.objects.get(pk=posted_user_id)
            except User.DoesNotExist:
                messages.error(request, 'User not found.')
            else:
                if user_to_delete.is_superuser:
                    messages.error(request, 'System Admin accounts cannot be deleted.')
                else:
                    user_full_name = user_to_delete.get_full_name() or user_to_delete.username
                    user_email = user_to_delete.email
                    user_to_delete.delete()
                    messages.success(
                        request,
                        f'User {user_full_name} ({user_email}) has been deleted successfully.',
                    )

    return render(request, 'system_admin/delete_user.html', context)


@login_required(login_url='/login/')
def manage_passwords_view(request):
    """Manage Passwords view."""
    if not request.user.is_superuser:
        logout(request)
        return redirect(f"{reverse('auth:login')}?session_ended=1")

    return render(request, 'system_admin/manage_passwords.html', {
        'pending_requests': 0,
        'password_changes_this_month': 0,
    })


@login_required(login_url='/login/')
def upload_profile_image_view(request):
    """Handle profile image upload."""
    if not request.user.is_superuser:
        return JsonResponse({
            'success': False,
            'message': 'Unauthorized',
            'notification': {'message': 'Unauthorized', 'type': 'error'}
        }, status=403)
    
    if request.method == 'POST' and request.FILES.get('profile_image'):
        profile, created = UserProfile.objects.get_or_create(user=request.user)
        # Delete old image if exists
        if profile.profile_image:
            profile.profile_image.delete()
        profile.profile_image = request.FILES['profile_image']
        profile.save()
        return JsonResponse({
            'success': True,
            'message': 'Profile image uploaded successfully',
            'image_url': profile.profile_image.url,
            'notification': {'message': 'Profile image uploaded successfully', 'type': 'success'}
        })
    
    return JsonResponse({
        'success': False,
        'message': 'No image provided',
        'notification': {'message': 'No image provided', 'type': 'error'}
    }, status=400)


@login_required(login_url='/login/')
def remove_profile_image_view(request):
    """Handle profile image removal."""
    if not request.user.is_superuser:
        return JsonResponse({
            'success': False,
            'message': 'Unauthorized',
            'notification': {'message': 'Unauthorized', 'type': 'error'}
        }, status=403)
    
    if request.method == 'POST':
        try:
            profile = UserProfile.objects.get(user=request.user)
            if profile.profile_image:
                profile.profile_image.delete()
                profile.profile_image = None
                profile.save()
            return JsonResponse({
                'success': True,
                'message': 'Profile image removed successfully',
                'notification': {'message': 'Profile image removed successfully', 'type': 'success'}
            })
        except UserProfile.DoesNotExist:
            return JsonResponse({
                'success': True,
                'message': 'Profile image removed successfully',
                'notification': {'message': 'Profile image removed successfully', 'type': 'success'}
            })
    
    return JsonResponse({
        'success': False,
        'message': 'Invalid request',
        'notification': {'message': 'Invalid request', 'type': 'error'}
    }, status=400)


@login_required(login_url='/login/')
def all_users_view(request):
    """All Users view."""
    if not request.user.is_superuser:
        logout(request)
        return redirect(f"{reverse('auth:login')}?session_ended=1")
    return render(request, 'system_admin/all_users.html')


@login_required(login_url='/login/')
def view_user_view(request, user_id):
    """View User detail view."""
    if not request.user.is_superuser:
        logout(request)
        return redirect(f"{reverse('auth:login')}?session_ended=1")
    return render(request, 'system_admin/view_user.html', {'user_id': user_id})


@login_required(login_url='/login/')
def users_api_view(request):
    """API endpoint to fetch all users."""
    if not request.user.is_superuser:
        return JsonResponse({
            'success': False,
            'message': 'Unauthorized',
            'users': []
        }, status=403)
    
    try:
        users = User.objects.all().select_related('profile').order_by('-date_joined')
        users_data = []
        
        for user in users:
            profile = getattr(user, 'profile', None)
            
            # Get full name
            full_name = user.get_full_name() or (user.first_name + ' ' + user.last_name).strip() or None
            
            # Get role
            role = None
            if user.is_superuser:
                role = 'system_admin'
            elif profile and profile.role:
                role = profile.role
            
            # Format dates
            account_creation_date = None
            account_creation_time = None
            if profile and profile.account_creation_date:
                account_creation_date = profile.account_creation_date.strftime('%B %d, %Y')
                if profile.account_creation_time:
                    account_creation_time = profile.account_creation_time.strftime('%I:%M %p')
            
            date_joined = user.date_joined.strftime('%B %d, %Y at %I:%M %p') if user.date_joined else None
            last_login = user.last_login.strftime('%B %d, %Y at %I:%M %p') if user.last_login else None
            created_source = None
            if profile and profile.account_creation_date:
                created_time = profile.account_creation_time or datetime.min.time()
                created_source = datetime.combine(profile.account_creation_date, created_time)
            elif user.date_joined:
                created_source = user.date_joined
            created_display = created_source.strftime('%b %d, %Y at %I:%M %p') if created_source else None
            last_login_display = user.last_login.strftime('%b %d, %Y at %I:%M %p') if user.last_login else None
            
            # Profile image URL
            profile_image = None
            if profile and profile.profile_image:
                profile_image = profile.profile_image.url
            
            user_data = {
                'id': user.id,
                'username': user.username,
                'email': user.email,
                'first_name': user.first_name or '',
                'last_name': user.last_name or '',
                'full_name': full_name,
                'is_active': user.is_active,
                'is_staff': user.is_staff,
                'is_superuser': user.is_superuser,
                'role': role,
                'profile_image': profile_image,
                'account_creation_date': account_creation_date,
                'account_creation_time': account_creation_time,
                'date_joined': date_joined,
                'last_login': last_login,
                'created_display': created_display,
                'last_login_display': last_login_display,
                'password_setup_completed': profile.password_setup_completed if profile else False,
            }
            users_data.append(user_data)
        
        return JsonResponse({
            'success': True,
            'users': users_data
        })
    except Exception as e:
        return JsonResponse({
            'success': False,
            'message': str(e),
            'users': []
        }, status=500)


@login_required(login_url='/login/')
def user_detail_api_view(request, user_id):
    """API endpoint to fetch a single user's details."""
    if not request.user.is_superuser:
        return JsonResponse({
            'success': False,
            'message': 'Unauthorized',
            'user': None
        }, status=403)
    
    try:
        user = User.objects.select_related('profile').get(pk=user_id)
        profile = getattr(user, 'profile', None)
        full_name = user.get_full_name() or (user.first_name + ' ' + user.last_name).strip() or None

        role = None
        if user.is_superuser:
            role = 'system_admin'
        elif profile and profile.role:
            role = profile.role

        account_creation_date = None
        account_creation_time = None
        if profile and profile.account_creation_date:
            account_creation_date = profile.account_creation_date.strftime('%B %d, %Y')
            if profile.account_creation_time:
                account_creation_time = profile.account_creation_time.strftime('%I:%M %p')

        profile_image = None
        if profile and profile.profile_image:
            profile_image = profile.profile_image.url

        user_data = {
            'id': user.id,
            'username': user.username,
            'email': user.email,
            'full_name': full_name,
            'is_active': user.is_active,
            'is_superuser': user.is_superuser,
            'role': role,
            'profile_image': profile_image,
            'account_creation_date': account_creation_date,
            'account_creation_time': account_creation_time,
        }
        
        return JsonResponse({
            'success': True,
            'user': user_data
        })
    except User.DoesNotExist:
        return JsonResponse({
            'success': False,
            'message': 'User not found',
            'user': None
        }, status=404)
    except Exception as e:
        return JsonResponse({
            'success': False,
            'message': str(e),
            'user': None
        }, status=500)


def _permission_subject(user_id):
    """Return a manager/editor and profile, or an error message."""
    try:
        user = User.objects.select_related('profile').get(pk=user_id)
    except User.DoesNotExist:
        return None, None, None, 'That user could not be found.'

    profile, _ = UserProfile.objects.get_or_create(user=user)
    role = 'system_admin' if user.is_superuser else profile.role
    if role not in ('manager', 'editor'):
        return None, None, None, 'Permissions can only be managed for manager or editor accounts.'
    return user, profile, role, None


def _save_permission_flags(profile, role, post_data):
    if role == 'manager':
        profile.can_access_dashboard = post_data.get('can_access_dashboard') == 'on'
    else:
        profile.can_access_dashboard = False
    profile.can_access_security = post_data.get('can_access_security') == 'on'
    profile.can_access_account_information = post_data.get('can_access_account_information') == 'on'
    profile.can_access_layer_uploader = post_data.get('can_access_layer_uploader') == 'on'
    profile.can_access_my_edits = post_data.get('can_access_my_edits') == 'on'
    profile.save()


def _has_any_permission(profile, role):
    flags = [
        profile.can_access_security,
        profile.can_access_account_information,
        profile.can_access_layer_uploader,
        profile.can_access_my_edits,
    ]
    if role == 'manager':
        flags.append(profile.can_access_dashboard)
    return any(flags)


def _permissions_form_view(request, user_id, template_name, success_message):
    if not request.user.is_superuser:
        logout(request)
        return redirect(f"{reverse('auth:login')}?session_ended=1")

    target_user, profile, role, error = _permission_subject(user_id)
    if error:
        if 'could not be found' in error:
            messages.error(request, error)
        else:
            messages.warning(request, error)
        return redirect('system_admin:permissions')

    if request.method == 'POST':
        _save_permission_flags(profile, role, request.POST)
        messages.success(
            request,
            success_message.format(target_user.get_full_name() or target_user.email),
        )
        return redirect('system_admin:permissions')

    return render(request, template_name, {
        'target_user': target_user,
        'profile': profile,
        'role': role,
    })


@login_required(login_url='/login/')
def permissions_view(request):
    if not request.user.is_superuser:
        logout(request)
        return redirect(f"{reverse('auth:login')}?session_ended=1")
    return render(request, 'system_admin/permissions.html')


@login_required(login_url='/login/')
def grant_permission_view(request, user_id):
    return _permissions_form_view(
        request,
        user_id,
        'system_admin/grant_permission.html',
        'Permissions have been granted successfully to {}.',
    )


@login_required(login_url='/login/')
def check_permission_view(request, user_id):
    return _permissions_form_view(
        request,
        user_id,
        'system_admin/check_permission.html',
        'Permissions have been updated successfully for {}.',
    )


@login_required(login_url='/login/')
def permissions_api_view(request):
    if not request.user.is_superuser:
        return JsonResponse({'success': False, 'message': 'Unauthorized', 'users': []}, status=403)

    try:
        users_data = []
        users = User.objects.select_related('profile').order_by('-date_joined')
        for user in users:
            if user.is_superuser:
                continue
            profile = getattr(user, 'profile', None)
            role = profile.role if profile else None
            if role not in ('manager', 'editor'):
                continue
            full_name = user.get_full_name() or (user.first_name + ' ' + user.last_name).strip() or None
            users_data.append({
                'id': user.id,
                'email': user.email,
                'full_name': full_name,
                'role': role,
                'has_permissions': _has_any_permission(profile, role),
            })
        return JsonResponse({'success': True, 'users': users_data})
    except Exception as e:
        return JsonResponse({'success': False, 'message': str(e), 'users': []}, status=500)


@login_required(login_url='/login/')
def my_edits_view(request):
    """My Edits history for system administrators."""
    if not request.user.is_superuser:
        logout(request)
        return redirect(f"{reverse('auth:login')}?session_ended=1")

    denied = enforce_my_edits_access(request)
    if denied:
        return denied

    context = my_edits_page_context(request.user)
    return render(request, "system_admin/my_edits.html", context)