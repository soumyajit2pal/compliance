(function() {
	// core/login-encryption.ts
	/** Shared portal/Swagger protocol. Fetch a fresh single-use challenge on every attempt. */
	async function encryptedSignIn(request, username, password) {
		return request("/auth/login", "POST", await encryptLogin(await request("/auth/login-key"), username, password));
	}
	var decode = (value) => Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
	var encode = (value) => btoa(Array.from(new Uint8Array(value instanceof Uint8Array ? value.buffer : value), (byte) => String.fromCharCode(byte)).join(""));
	async function encryptLogin(key, username, password) {
		if (!window.crypto?.subtle || key.algorithm !== "RSA-OAEP-256+A256GCM") throw new Error("Secure sign-in requires HTTPS and a supported browser.");
		const plaintext = new TextEncoder().encode(JSON.stringify({
			username,
			password
		}));
		let rawKey;
		try {
			const publicKey = await crypto.subtle.importKey("spki", decode(key.public_key), {
				name: "RSA-OAEP",
				hash: "SHA-256"
			}, false, ["encrypt"]);
			const aesKey = await crypto.subtle.generateKey({
				name: "AES-GCM",
				length: 256
			}, true, ["encrypt"]);
			const iv = crypto.getRandomValues(/* @__PURE__ */ new Uint8Array(12));
			const ciphertext = await crypto.subtle.encrypt({
				name: "AES-GCM",
				iv,
				additionalData: new TextEncoder().encode(key.challenge),
				tagLength: 128
			}, aesKey, plaintext);
			rawKey = await crypto.subtle.exportKey("raw", aesKey);
			const wrappedKey = await crypto.subtle.encrypt({ name: "RSA-OAEP" }, publicKey, rawKey);
			return {
				key_id: key.key_id,
				challenge: key.challenge,
				wrapped_key: encode(wrappedKey),
				iv: encode(iv),
				ciphertext: encode(ciphertext)
			};
		} catch {
			throw new Error("Secure sign-in could not be prepared. Refresh and try again.");
		} finally {
			plaintext.fill(0);
			if (rawKey) new Uint8Array(rawKey).fill(0);
		}
	}
	// core/ldap-readiness.ts
	/** Presentation only. The API remains the authority for access and decisions. */
	function ldapDepartmentState(user) {
		const status = user.ldap_department_status;
		const approved = user.department_code;
		const current = user.ldap_last_seen_department_code;
		const valid = (value) => typeof value === "string" && value.trim().length > 0 && [...value].length <= 100 && !/[\x00-\x1f\x7f]/.test(value);
		const matches = Boolean(valid(approved) && valid(current) && approved === current);
		if (status === "UNAVAILABLE") return {
			key: "unavailable",
			label: "LDAP department code unavailable",
			tone: "amber",
			approved: false,
			blocked: true,
			detail: "LDAP must return one valid department code before it can be verified."
		};
		if (status === "MISMATCH" || ["VERIFIED", "RECHECK_REQUIRED"].includes(status) && valid(approved) && valid(current) && approved !== current) return {
			key: "changed",
			label: "Department code changed — approval required",
			tone: "amber",
			approved: false,
			blocked: true,
			detail: "The current LDAP code differs from the approved code. Application access is blocked."
		};
		if (status === "RECHECK_REQUIRED" && matches) return {
			key: "recheck",
			label: "Department approved — sign-in required",
			tone: "neutral",
			approved: true,
			blocked: true,
			detail: "The update is approved. The user must sign in with LDAP again to verify the current code."
		};
		if (status === "VERIFIED" && matches) return {
			key: "approved",
			label: "Department code approved",
			tone: "green",
			approved: true,
			blocked: false,
			detail: "The current LDAP code matches the approved code."
		};
		return {
			key: "not-approved",
			label: "Department code not approved",
			tone: "amber",
			approved: false,
			blocked: true,
			detail: "Application access is blocked until the LDAP department code is independently approved."
		};
	}
	// core/swagger-request.ts
	/** Swagger uses the same cookie/CSRF contract as the portal; API authority is unchanged. */
	function createSwaggerRequestGuard(origin, requestFetch, expired = () => {}) {
		const readMethods = /* @__PURE__ */ new Set([
			"GET",
			"HEAD",
			"OPTIONS"
		]);
		return async (request) => {
			const url = new URL(request.url, origin);
			if (url.origin !== origin || url.pathname !== "/openapi.json" && !url.pathname.startsWith("/api/")) throw new Error("Swagger can call only this portal’s API.");
			request.credentials = "same-origin";
			const method = String(request.method || "GET").toUpperCase();
			if (!readMethods.has(method) && url.pathname !== "/api/auth/login") {
				const response = await requestFetch("/api/auth/me", {
					credentials: "same-origin",
					cache: "no-store"
				});
				if (!response.ok) {
					if (response.status === 401) expired();
					throw new Error("Sign in using the form above, then retry this request.");
				}
				const identity = await response.json();
				if (typeof identity.csrf_token !== "string" || !identity.csrf_token) {
					expired();
					throw new Error("Your session is unavailable. Sign in again above.");
				}
				request.headers = request.headers || {};
				request.headers["X-CSRF-Token"] = identity.csrf_token;
			}
			return request;
		};
	}
	function swaggerOptions(requestInterceptor, responseInterceptor) {
		return {
			url: "/openapi.json",
			dom_id: "#swagger-ui",
			deepLinking: true,
			docExpansion: "list",
			displayRequestDuration: true,
			defaultModelsExpandDepth: -1,
			filter: true,
			validatorUrl: null,
			queryConfigEnabled: false,
			persistAuthorization: false,
			withCredentials: true,
			showMutatedRequest: false,
			supportedSubmitMethods: [
				"get",
				"put",
				"post",
				"delete",
				"options",
				"head",
				"patch"
			],
			requestInterceptor,
			responseInterceptor
		};
	}
	// docs/swagger.ts
	var section = document.getElementById("docs-session");
	var form = document.getElementById("docs-login");
	var fields = document.getElementById("docs-login-fields");
	var username = document.getElementById("docs-username");
	var password = document.getElementById("docs-password");
	var submit = document.getElementById("docs-sign-in");
	var account = document.getElementById("docs-account");
	var accountName = document.getElementById("docs-account-name");
	var accountRoles = document.getElementById("docs-account-roles");
	var signOut = document.getElementById("docs-sign-out");
	var refresh = document.getElementById("docs-session-refresh");
	var status = document.getElementById("docs-auth-status");
	var error = document.getElementById("docs-auth-error");
	var action = document.getElementById("docs-setup-link");
	var identity = null;
	var busy = false;
	function signedOut(message = "Sign in to test protected APIs.") {
		identity = null;
		form.hidden = false;
		account.hidden = true;
		action.hidden = true;
		accountName.textContent = "";
		accountRoles.textContent = "";
		password.value = "";
		status.textContent = message;
		section.dataset.access = "signed-out";
	}
	var prepare = createSwaggerRequestGuard(location.origin, fetch.bind(window), () => signedOut("Your session has ended. Sign in again."));
	async function request(path, method = "GET", body) {
		const prepared = await prepare({
			url: "/api" + path,
			method,
			headers: body === void 0 ? {} : { "Content-Type": "application/json" },
			body: body === void 0 ? void 0 : JSON.stringify(body)
		});
		const response = await fetch(prepared.url, {
			method,
			headers: prepared.headers,
			body: prepared.body,
			credentials: "same-origin",
			cache: "no-store"
		});
		const data = await response.json().catch(() => ({}));
		if (!response.ok) {
			if (response.status === 401 && path !== "/auth/login") signedOut();
			throw Object.assign(new Error(typeof data.detail === "string" ? data.detail : "The request could not be completed."), { status: response.status });
		}
		return data;
	}
	function showIdentity(data) {
		identity = {
			user: data.user,
			roles: data.roles || []
		};
		const user = identity.user, requirements = [];
		if (user.must_change_password_flag) requirements.push("Change your temporary password.");
		if (user.needs_email_confirmation_flag || user.needs_department_selection_flag) requirements.push("Confirm your work email and Home organisation.");
		if (user.login_type === "LDAP") {
			const department = ldapDepartmentState(user);
			if (department.blocked) {
				requirements.push(department.label + ".");
				if (user.department_code || user.ldap_last_seen_department_code) requirements.push("Approved LDAP code: " + (user.department_code || "Not approved") + "; current LDAP code: " + (user.ldap_last_seen_department_code || "Unavailable") + ".");
			}
		}
		if (!identity.roles.length) requirements.push("Administrator-approved roles and scope are required.");
		form.hidden = true;
		account.hidden = false;
		password.value = "";
		accountName.textContent = (user.full_name || user.username) + " · " + user.username;
		accountRoles.textContent = "Roles: " + (identity.roles.join(", ") || "None assigned");
		action.hidden = !requirements.length;
		status.textContent = requirements.length ? "Signed in — access restricted. " + requirements.join(" ") : "Signed in. Try it out uses your current roles and scope.";
		section.dataset.access = requirements.length ? "restricted" : "ready";
	}
	async function session() {
		status.textContent = "Checking session…";
		try {
			showIdentity(await request("/auth/me"));
		} catch (caught) {
			if (caught.status === 401) signedOut();
			else {
				status.textContent = "Session details could not be checked. Refresh session to try again.";
				throw caught;
			}
		}
	}
	function setBusy(value) {
		busy = value;
		section.setAttribute("aria-busy", String(value));
		fields.disabled = value;
		signOut.disabled = value;
		refresh.disabled = value;
		submit.textContent = value ? "Signing in…" : "Sign in";
	}
	function showError(caught) {
		error.textContent = caught.message || "Sign-in could not be completed.";
		error.hidden = false;
	}
	async function run(task) {
		if (busy) return;
		setBusy(true);
		error.hidden = true;
		error.textContent = "";
		try {
			await task();
		} catch (caught) {
			showError(caught);
		} finally {
			setBusy(false);
		}
	}
	form.addEventListener("submit", (event) => {
		event.preventDefault();
		if (busy) return;
		const loginName = username.value.trim(), secret = password.value;
		password.value = "";
		run(async () => {
			status.textContent = "Signing in…";
			try {
				await encryptedSignIn(request, loginName, secret);
			} catch (caught) {
				signedOut("Sign-in was not completed. Try again.");
				throw caught;
			}
			await session();
		});
	});
	signOut.addEventListener("click", () => void run(async () => {
		status.textContent = "Signing out…";
		await request("/auth/logout", "POST", {});
		signedOut("Signed out.");
		username.focus();
	}));
	refresh.addEventListener("click", () => void run(session));
	window.addEventListener("focus", () => {
		if (!busy) run(session);
	});
	var swagger = window.SwaggerUIBundle;
	window.ui = swagger({
		...swaggerOptions(prepare, (response) => {
			if (response.status === 401) signedOut("Your session has ended. Sign in again.");
			return response;
		}),
		presets: [swagger.presets.apis],
		layout: "BaseLayout"
	});
	run(session);
})();
