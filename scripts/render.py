#!/usr/bin/env python3
"""Render one page in headless Chromium and print its HTML as JSON.

Every request, including subresources and redirects, is sent to the parent process on stdout as
{"id": n, "check": url} and allowed only on {"id": n, "ok": true} from stdin. The parent owns the
URL policy. A fresh context per run: no cookies, no storage, no service workers, no downloads.
"""
import json
import sys

from playwright.sync_api import sync_playwright

url = sys.argv[1]
timeout_ms = int(sys.argv[2]) if len(sys.argv) > 2 else 45000
blocked: list[str] = []
counter = {"n": 0}


def allowed(target: str) -> bool:
	counter["n"] += 1
	sys.stdout.write(json.dumps({"id": counter["n"], "check": target}) + "\n")
	sys.stdout.flush()
	reply = json.loads(sys.stdin.readline() or "{}")
	return bool(reply.get("ok")) and reply.get("id") == counter["n"]


def handle(route):
	target = route.request.url
	if target.startswith(("data:", "blob:", "about:")):
		route.continue_()
	elif allowed(target):
		route.continue_()
	else:
		blocked.append(target)
		route.abort("blockedbyclient")


with sync_playwright() as p:
	browser = p.chromium.launch(headless=True)
	try:
		context = browser.new_context(
			accept_downloads=False,
			service_workers="block",
			user_agent="Mozilla/5.0 (compatible; PiDeepResearch/1.0)",
		)
		context.route("**/*", handle)
		# route() does not see WebSockets. Best effort: remove the constructor from every page and frame.
		# A worker or a page that restores the native constructor is not covered.
		context.add_init_script("window.WebSocket = function () { throw new Error('WebSocket disabled'); }; window.WebSocketStream = undefined;")
		page = context.new_page()
		page.goto(url, wait_until="networkidle", timeout=timeout_ms)
		print(json.dumps({"result": {"html": page.content(), "title": page.title(), "final_url": page.url, "blocked": blocked}}))
	finally:
		browser.close()
