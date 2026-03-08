from django.shortcuts import render, redirect
from django.contrib.auth.decorators import login_required
from django.contrib.auth import logout
from django.contrib.auth.models import User
from django.core.validators import validate_email
from django.core.exceptions import ValidationError
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_http_methods
from .models import UserProfile
import json


@login_required(login_url='/login/')
def map_view(request):
    """System Admin Map view - landing page after login."""
    if not request.user.is_superuser:
        logout(request)
        return redirect('auth:login')
    return render(request, 'system_admin/map.html')


@login_required(login_url='/login/')
def account_information_view(request):
    """Account Information view."""
    # Only allow superusers (system admins) to access
    if not request.user.is_superuser:
        logout(request)
        return redirect('auth:login')

    # Get or create user profile
    profile, created = UserProfile.objects.get_or_create(user=request.user)
    
    # Set account creation date/time if not already set (for existing system admins)
    if not profile.account_creation_date:
        profile.set_account_creation_datetime()
    
    context = {'profile': profile}

    if request.method == 'POST':
        intent = request.POST.get('intent')
        if intent == 'update_profile':
            errors = []
            full_name = request.POST.get('full_name', '').strip()
            email = request.POST.get('email', '').strip()

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
                    if User.objects.filter(username=email).exclude(pk=request.user.pk).exists():
                        errors.append('This email is already in use.')

            if not errors:
                user = request.user
                old_email = user.email
                old_username = user.username
                user.first_name = full_name
                user.last_name = ''
                user.email = email
                user.username = email
                user.save()

                if old_email != email or old_username != email:
                    logout(request)
                    return redirect('/login/?email_changed=1')

                context['profile_updated'] = True
            else:
                context['update_errors'] = errors

    return render(request, 'system_admin/account_information.html', context)


@login_required(login_url='/login/')
def security_view(request):
    """Security view."""
    # Only allow superusers (system admins) to access
    if not request.user.is_superuser:
        logout(request)
        return redirect('auth:login')

    context = {}

    if request.method == 'POST':
        intent = request.POST.get('intent')

        if intent == 'change_password':
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
                context['change_errors'] = errors

    return render(request, 'system_admin/security.html', context)


@login_required(login_url='/login/')
def users_view(request):
    """Users view."""
    # Only allow superusers (system admins) to access
    if not request.user.is_superuser:
        logout(request)
        return redirect('auth:login')
    
    from django.utils import timezone
    
    # Calculate statistics
    all_users_count = User.objects.count()
    active_users_count = User.objects.filter(is_active=True).count()
    
    # Users created this month
    now = timezone.now()
    start_of_month = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    users_this_month = User.objects.filter(date_joined__gte=start_of_month).count()
    
    context = {
        'all_users_count': all_users_count,
        'active_users_count': active_users_count,
        'users_this_month': users_this_month,
    }
    
    return render(request, 'system_admin/users.html', context)


@login_required(login_url='/login/')
def add_user_view(request):
    """Add User view."""
    # Only allow superusers (system admins) to access
    if not request.user.is_superuser:
        logout(request)
        return redirect('auth:login')
    
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
                # For managers, check if permissions are provided
                if role == 'manager':
                    can_access_dashboard = request.POST.get('can_access_dashboard') == 'on'
                    can_access_security = request.POST.get('can_access_security') == 'on'
                    can_access_account_information = request.POST.get('can_access_account_information') == 'on'
                # For editors, check if permissions are provided
                elif role == 'editor':
                    can_access_dashboard = False  # Editors don't have dashboard permission
                    can_access_security = request.POST.get('can_access_security') == 'on'
                    can_access_account_information = request.POST.get('can_access_account_information') == 'on'
                else:
                    can_access_dashboard = False
                    can_access_security = False
                    can_access_account_information = False
                
                # Create user
                user = User.objects.create_user(
                    username=email,
                    email=email,
                    password=password,
                    first_name=full_name.split()[0] if full_name.split() else '',
                    last_name=' '.join(full_name.split()[1:]) if len(full_name.split()) > 1 else '',
                    is_active=True
                )
                
                # Create user profile with role, permissions, and account creation date/time
                profile = UserProfile.objects.create(
                    user=user,
                    role=role,
                    can_access_dashboard=can_access_dashboard,
                    can_access_security=can_access_security,
                    can_access_account_information=can_access_account_information
                )
                profile.set_account_creation_datetime()
                
                context['user_added'] = True
                context['success_message'] = f'User {full_name} has been added successfully as {role.title()}.'
            else:
                context['add_errors'] = errors
    
    return render(request, 'system_admin/add_user.html', context)


@login_required(login_url='/login/')
def edit_user_view(request):
    """Edit User view."""
    # Only allow superusers (system admins) to access
    if not request.user.is_superuser:
        logout(request)
        return redirect('auth:login')
    
    context = {}
    user_to_edit = None
    
    if request.method == 'POST':
        intent = request.POST.get('intent')
        
        if intent == 'search_user':
            email = request.POST.get('search_email', '').strip()
            if not email:
                context['search_errors'] = ['Email is required to search for a user.']
            else:
                try:
                    user_to_edit = User.objects.get(username=email)
                    # Don't allow editing system admins
                    if user_to_edit.is_superuser:
                        context['search_errors'] = ['System Admin accounts cannot be edited through this page.']
                        user_to_edit = None
                    else:
                        # Get or create profile
                        profile, created = UserProfile.objects.get_or_create(user=user_to_edit)
                        context['user_to_edit'] = user_to_edit
                        context['user_profile'] = profile
                except User.DoesNotExist:
                    context['search_errors'] = ['User with this email does not exist.']
        
        elif intent == 'update_user':
            # Get user from form
            user_id = request.POST.get('user_id')
            if not user_id:
                context['update_errors'] = ['User ID is required.']
            else:
                try:
                    user_to_edit = User.objects.get(pk=user_id)
                    if user_to_edit.is_superuser:
                        context['update_errors'] = ['System Admin accounts cannot be edited.']
                    else:
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
                                # Check if email is already taken by another user
                                if User.objects.filter(username=email).exclude(pk=user_to_edit.pk).exists():
                                    errors.append('A user with this email already exists.')
                        
                        if account_status not in ['active', 'inactive']:
                            errors.append('Invalid account status selected.')
                        
                        if not errors:
                            # Update user
                            user_to_edit.first_name = full_name.split()[0] if full_name.split() else ''
                            user_to_edit.last_name = ' '.join(full_name.split()[1:]) if len(full_name.split()) > 1 else ''
                            user_to_edit.email = email
                            user_to_edit.username = email
                            user_to_edit.is_active = (account_status == 'active')
                            user_to_edit.save()
                            
                            context['user_updated'] = True
                            context['success_message'] = f'User {full_name} has been updated successfully.'
                            context['user_to_edit'] = user_to_edit
                            if hasattr(user_to_edit, 'profile'):
                                context['user_profile'] = user_to_edit.profile
                        else:
                            context['update_errors'] = errors
                            context['user_to_edit'] = user_to_edit
                            if hasattr(user_to_edit, 'profile'):
                                context['user_profile'] = user_to_edit.profile
                except User.DoesNotExist:
                    context['update_errors'] = ['User not found.']
    
    return render(request, 'system_admin/edit_user.html', context)


@login_required(login_url='/login/')
def delete_user_view(request):
    """Delete User view."""
    # Only allow superusers (system admins) to access
    if not request.user.is_superuser:
        logout(request)
        return redirect('auth:login')
    
    context = {}
    user_to_delete = None
    
    if request.method == 'POST':
        intent = request.POST.get('intent')
        
        if intent == 'search_user':
            email = request.POST.get('search_email', '').strip()
            if not email:
                context['search_errors'] = ['Email is required to search for a user.']
            else:
                try:
                    user_to_delete = User.objects.get(username=email)
                    # Don't allow deleting system admins
                    if user_to_delete.is_superuser:
                        context['search_errors'] = ['System Admin accounts cannot be deleted through this page.']
                        user_to_delete = None
                    else:
                        # Get profile if exists
                        if hasattr(user_to_delete, 'profile'):
                            context['user_profile'] = user_to_delete.profile
                        context['user_to_delete'] = user_to_delete
                except User.DoesNotExist:
                    context['search_errors'] = ['User with this email does not exist.']
        
        elif intent == 'delete_user':
            user_id = request.POST.get('user_id')
            if user_id:
                try:
                    user_to_delete = User.objects.get(pk=user_id)
                    if user_to_delete.is_superuser:
                        context['delete_errors'] = ['System Admin accounts cannot be deleted.']
                    else:
                        # Store user info for success message
                        user_full_name = user_to_delete.get_full_name() or user_to_delete.username
                        user_email = user_to_delete.email
                        
                        # Delete user (this will cascade delete profile due to CASCADE relationship)
                        user_to_delete.delete()
                        
                        context['user_deleted'] = True
                        context['success_message'] = f'User {user_full_name} ({user_email}) has been deleted successfully.'
                except User.DoesNotExist:
                    context['delete_errors'] = ['User not found.']
    
    return render(request, 'system_admin/delete_user.html', context)


@login_required(login_url='/login/')
def manage_passwords_view(request):
    """Manage Passwords view."""
    # Only allow superusers (system admins) to access
    if not request.user.is_superuser:
        logout(request)
        return redirect('auth:login')
    
    # Calculate statistics
    # Pending forgot password requests (placeholder - will be implemented when forgot password model is created)
    # For now, we'll use 0 as a placeholder
    pending_requests = 0
    
    # Password changes this month (placeholder - will track when password change model is created)
    # For now, we'll use 0 as a placeholder
    password_changes_this_month = 0
    
    context = {
        'pending_requests': pending_requests,
        'password_changes_this_month': password_changes_this_month,
    }
    
    return render(request, 'system_admin/manage_passwords.html', context)


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
    # Only allow superusers (system admins) to access
    if not request.user.is_superuser:
        logout(request)
        return redirect('auth:login')
    
    return render(request, 'system_admin/all_users.html')


@login_required(login_url='/login/')
def view_user_view(request, user_id):
    """View User detail view."""
    # Only allow superusers (system admins) to access
    if not request.user.is_superuser:
        logout(request)
        return redirect('auth:login')
    
    return render(request, 'system_admin/view_user.html')


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
            'password_setup_completed': profile.password_setup_completed if profile else False,
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


@login_required(login_url='/login/')
def permissions_view(request):
    """Permissions management view."""
    # Only allow superusers (system admins) to access
    if not request.user.is_superuser:
        logout(request)
        return redirect('auth:login')
    
    return render(request, 'system_admin/permissions.html')


@login_required(login_url='/login/')
def grant_permission_view(request, user_id):
    """Grant permissions view for users without permissions."""
    # Only allow superusers (system admins) to access
    if not request.user.is_superuser:
        logout(request)
        return redirect('auth:login')
    
    try:
        user = User.objects.select_related('profile').get(pk=user_id)
        profile, created = UserProfile.objects.get_or_create(user=user)
        
        # Get role
        role = None
        if user.is_superuser:
            role = 'system_admin'
        elif profile.role:
            role = profile.role
        
        # Only allow granting permissions for managers and editors
        if role not in ['manager', 'editor']:
            return redirect('system_admin:permissions')
        
        context = {
            'user': user,
            'profile': profile,
            'role': role,
            'permissions_granted': False
        }
        
        if request.method == 'POST':
            intent = request.POST.get('intent')
            if intent == 'grant_permissions':
                # Update permissions based on role
                if role == 'manager':
                    profile.can_access_dashboard = request.POST.get('can_access_dashboard') == 'on'
                    profile.can_access_security = request.POST.get('can_access_security') == 'on'
                    profile.can_access_account_information = request.POST.get('can_access_account_information') == 'on'
                elif role == 'editor':
                    profile.can_access_dashboard = False
                    profile.can_access_security = request.POST.get('can_access_security') == 'on'
                    profile.can_access_account_information = request.POST.get('can_access_account_information') == 'on'
                
                profile.save()
                context['permissions_granted'] = True
                context['success_message'] = f'Permissions have been granted successfully to {user.get_full_name() or user.email}.'
        
        return render(request, 'system_admin/grant_permission.html', context)
    except User.DoesNotExist:
        return redirect('system_admin:permissions')


@login_required(login_url='/login/')
def check_permission_view(request, user_id):
    """Check/Edit permissions view for users with existing permissions."""
    # Only allow superusers (system admins) to access
    if not request.user.is_superuser:
        logout(request)
        return redirect('auth:login')
    
    try:
        user = User.objects.select_related('profile').get(pk=user_id)
        profile, created = UserProfile.objects.get_or_create(user=user)
        
        # Get role
        role = None
        if user.is_superuser:
            role = 'system_admin'
        elif profile.role:
            role = profile.role
        
        # Only allow checking permissions for managers and editors
        if role not in ['manager', 'editor']:
            return redirect('system_admin:permissions')
        
        context = {
            'user': user,
            'profile': profile,
            'role': role,
            'permissions_updated': False
        }
        
        if request.method == 'POST':
            intent = request.POST.get('intent')
            if intent == 'update_permissions':
                # Update permissions based on role
                if role == 'manager':
                    profile.can_access_dashboard = request.POST.get('can_access_dashboard') == 'on'
                    profile.can_access_security = request.POST.get('can_access_security') == 'on'
                    profile.can_access_account_information = request.POST.get('can_access_account_information') == 'on'
                elif role == 'editor':
                    profile.can_access_dashboard = False
                    profile.can_access_security = request.POST.get('can_access_security') == 'on'
                    profile.can_access_account_information = request.POST.get('can_access_account_information') == 'on'
                
                profile.save()
                context['permissions_updated'] = True
                context['success_message'] = f'Permissions have been updated successfully for {user.get_full_name() or user.email}.'
        
        return render(request, 'system_admin/check_permission.html', context)
    except User.DoesNotExist:
        return redirect('system_admin:permissions')


@login_required(login_url='/login/')
def permissions_api_view(request):
    """API endpoint to fetch all users with permissions data."""
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
            
            # Get permissions (only for managers and editors)
            has_permissions = False
            permissions = {
                'can_access_dashboard': False,
                'can_access_security': False,
                'can_access_account_information': False
            }
            
            if profile and role in ['manager', 'editor']:
                permissions['can_access_dashboard'] = profile.can_access_dashboard if role == 'manager' else False
                permissions['can_access_security'] = profile.can_access_security
                permissions['can_access_account_information'] = profile.can_access_account_information
                has_permissions = any([
                    permissions['can_access_dashboard'],
                    permissions['can_access_security'],
                    permissions['can_access_account_information']
                ])
            
            user_data = {
                'id': user.id,
                'username': user.username,
                'email': user.email,
                'first_name': user.first_name or '',
                'last_name': user.last_name or '',
                'full_name': full_name,
                'role': role,
                'has_permissions': has_permissions,
                'permissions': permissions
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
@require_http_methods(["POST"])
def update_permissions_api_view(request, user_id):
    """API endpoint to update user permissions."""
    if not request.user.is_superuser:
        return JsonResponse({
            'success': False,
            'message': 'Unauthorized'
        }, status=403)
    
    try:
        user = User.objects.select_related('profile').get(pk=user_id)
        profile, created = UserProfile.objects.get_or_create(user=user)
        
        # Get role
        role = None
        if user.is_superuser:
            role = 'system_admin'
        elif profile.role:
            role = profile.role
        
        # Only allow updating permissions for managers and editors
        if role not in ['manager', 'editor']:
            return JsonResponse({
                'success': False,
                'message': 'Permissions can only be set for managers and editors'
            }, status=400)
        
        # Parse JSON data
        try:
            data = json.loads(request.body.decode('utf-8'))
        except (json.JSONDecodeError, UnicodeDecodeError):
            return JsonResponse({
                'success': False,
                'message': 'Invalid JSON data'
            }, status=400)
        
        # Update permissions based on role
        if role == 'manager':
            profile.can_access_dashboard = data.get('can_access_dashboard', False)
            profile.can_access_security = data.get('can_access_security', False)
            profile.can_access_account_information = data.get('can_access_account_information', False)
        elif role == 'editor':
            # Editors don't have dashboard permission
            profile.can_access_dashboard = False
            profile.can_access_security = data.get('can_access_security', False)
            profile.can_access_account_information = data.get('can_access_account_information', False)
        
        profile.save()
        
        return JsonResponse({
            'success': True,
            'message': 'Permissions updated successfully',
            'notification': {'message': 'Permissions updated successfully', 'type': 'success'}
        })
    except User.DoesNotExist:
        return JsonResponse({
            'success': False,
            'message': 'User not found'
        }, status=404)
    except Exception as e:
        return JsonResponse({
            'success': False,
            'message': str(e)
        }, status=500)