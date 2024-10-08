/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2013 Red Hat, Inc.
 *
 * Cockpit is free software; you can redistribute it and/or modify it
 * under the terms of the GNU Lesser General Public License as published by
 * the Free Software Foundation; either version 2.1 of the License, or
 * (at your option) any later version.
 *
 * Cockpit is distributed in the hope that it will be useful, but
 * WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU
 * Lesser General Public License for more details.
 *
 * You should have received a copy of the GNU Lesser General Public License
 * along with Cockpit; If not, see <https://www.gnu.org/licenses/>.
 */

#ifndef __COCKPIT_AUTH_H__
#define __COCKPIT_AUTH_H__

#include <pwd.h>
#include <gio/gio.h>

#include "cockpitcreds.h"
#include "cockpitwebservice.h"

#include "common/cockpitpipe.h"
#include "common/cockpittransport.h"
#include "common/cockpitwebserver.h"

G_BEGIN_DECLS

typedef enum {
  COCKPIT_AUTH_NONE = 0,
  COCKPIT_AUTH_FOR_TLS_PROXY = 1 << 0,
} CockpitAuthFlags;

#define MAX_AUTH_TIMEOUT 900
#define MIN_AUTH_TIMEOUT 1

#define COCKPIT_TYPE_AUTH         (cockpit_auth_get_type ())
#define COCKPIT_AUTH(o)           (G_TYPE_CHECK_INSTANCE_CAST ((o), COCKPIT_TYPE_AUTH, CockpitAuth))
#define COCKPIT_IS_AUTH(o)        (G_TYPE_CHECK_INSTANCE_TYPE ((o), COCKPIT_TYPE_AUTH))
#define COCKPIT_AUTH_GET_CLASS(o) (G_TYPE_INSTANCE_GET_CLASS ((o), COCKPIT_TYPE_AUTH, CockpitAuthClass))
#define COCKPIT_IS_AUTH_CLASS(k)  (G_TYPE_CHECK_CLASS_TYPE ((k), COCKPIT_TYPE_AUTH))

typedef struct _CockpitAuth        CockpitAuth;
typedef struct _CockpitAuthClass   CockpitAuthClass;

struct _CockpitAuth
{
  GObject parent_instance;

  CockpitAuthFlags flags;
  GBytes *key;
  GHashTable *sessions;
  GHashTable *conversations;

  guint64 nonce_seed;
  gboolean login_loopback;
  gulong timeout_tag;
  guint startups;
  guint max_startups;
  guint max_startups_begin;
  guint max_startups_rate;
};

struct _CockpitAuthClass
{
  GObjectClass parent_class;
};

GType           cockpit_auth_get_type        (void) G_GNUC_CONST;

CockpitAuth *   cockpit_auth_new             (gboolean login_loopback, CockpitAuthFlags flags);

gchar *         cockpit_auth_nonce           (CockpitAuth *self);

void            cockpit_auth_login_async     (CockpitAuth *self,
                                              CockpitWebRequest *request,
                                              GAsyncReadyCallback callback,
                                              gpointer user_data);

JsonObject *    cockpit_auth_login_finish    (CockpitAuth *self,
                                              GAsyncResult *result,
                                              GIOStream *connection,
                                              GHashTable *out_headers,
                                              GError **error);

void            cockpit_auth_local_async     (CockpitAuth *self,
                                              const gchar *user,
                                              CockpitPipe *pipe,
                                              GAsyncReadyCallback callback,
                                              gpointer user_data);

gboolean        cockpit_auth_local_finish    (CockpitAuth *self,
                                              GAsyncResult *result,
                                              GError **error);

CockpitWebService *  cockpit_auth_check_cookie    (CockpitAuth *self,
                                                   CockpitWebRequest *request);

gboolean        cockpit_auth_is_valid_cookie_value (CockpitAuth *self,
                                                    const gchar *cookie_value);

  gchar *         cockpit_auth_parse_application    (const gchar *path,
                                                   gboolean *is_host);

gchar *         cockpit_auth_empty_cookie_value       (const gchar *path,
                                                       gboolean secure);

G_END_DECLS

#endif
