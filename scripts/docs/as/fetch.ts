// The tooltips of as/fetch.ts, in both languages: scripts/apply-docs.ts writes the
// one AMXTS_DOCS_LANG picks into the JSDoc above each element.
export default {
	'URL': {
		en: `
			A web address taken apart: its protocol, host, path and query.

			\`\`\`ts
			const url = new URL("https://example.com/api/stats?id=7");
			url.searchParams.set("map", server.map);
			const response = await fetch(url);
			\`\`\`
		`,
		ru: `
			Веб-адрес, разобранный на части: протокол, хост, путь и запрос.

			\`\`\`ts
			const url = new URL("https://example.com/api/stats?id=7");
			url.searchParams.set("map", server.map);
			const response = await fetch(url);
			\`\`\`
		`,
	},
	'URL.canParse': {
		en: `\`true\` when \`url\`, relative to \`base\` when given, is a URL \`new URL\` would take.`,
		ru: `\`true\`, если \`url\` (относительно \`base\`, когда он задан) — адрес, который примет \`new URL\`.`,
	},
	'URL.parse': {
		en: `The URL, or \`null\` when \`url\` is not one - \`new URL\` without the throw.`,
		ru: `Адрес или \`null\`, если \`url\` не адрес, — \`new URL\` без исключения.`,
	},
	'URL.href': {
		en: `The whole URL as text, e.g. \`"https://example.com/api?id=7"\`.`,
		ru: `Весь адрес текстом, например \`"https://example.com/api?id=7"\`.`,
	},
	'URL.protocol': {
		en: `The scheme with its colon, e.g. \`"https:"\`.`,
		ru: `Схема с двоеточием, например \`"https:"\`.`,
	},
	'URL.username': {
		en: `The user name before the host, e.g. \`"admin"\` in \`ftp://admin:secret@example.com\`; \`""\` when there is none.`,
		ru: `Имя пользователя перед хостом, например \`"admin"\` в \`ftp://admin:secret@example.com\`; \`""\`, если его нет.`,
	},
	'URL.password': {
		en: `The password before the host; \`""\` when there is none.`,
		ru: `Пароль перед хостом; \`""\`, если его нет.`,
	},
	'URL.host': {
		en: `The host with its port when the URL names one, e.g. \`"example.com:8080"\`.`,
		ru: `Хост с портом, когда адрес его называет, например \`"example.com:8080"\`.`,
	},
	'URL.hostname': {
		en: `The host without the port, e.g. \`"example.com"\`.`,
		ru: `Хост без порта, например \`"example.com"\`.`,
	},
	'URL.port': {
		en: `The port as text, e.g. \`"8080"\`; \`""\` for the protocol's default one.`,
		ru: `Порт текстом, например \`"8080"\`; \`""\` для порта протокола по умолчанию.`,
	},
	'URL.pathname': {
		en: `The path, e.g. \`"/api/stats"\`.`,
		ru: `Путь, например \`"/api/stats"\`.`,
	},
	'URL.search': {
		en: `The query with its \`?\`, e.g. \`"?id=7"\`; \`""\` when there is none.`,
		ru: `Запрос со знаком \`?\`, например \`"?id=7"\`; \`""\`, если его нет.`,
	},
	'URL.hash': {
		en: `The fragment with its \`#\`, e.g. \`"#top"\`; \`""\` when there is none.`,
		ru: `Фрагмент со знаком \`#\`, например \`"#top"\`; \`""\`, если его нет.`,
	},
	'URL.origin': {
		en: `The scheme, host and port, e.g. \`"https://example.com"\`; \`"null"\` for a URL without a host.`,
		ru: `Схема, хост и порт, например \`"https://example.com"\`; \`"null"\` для адреса без хоста.`,
	},
	'URL.searchParams': {
		en: `The query as names and values; a change to them changes the URL.`,
		ru: `Запрос как имена и значения; их изменение меняет адрес.`,
	},
	'URL.toString': {
		en: `The whole URL as text, as \`href\`.`,
		ru: `Весь адрес текстом, как \`href\`.`,
	},
	'URL.toJSON': {
		en: `The whole URL as text: what \`JSON.stringify\` writes for it.`,
		ru: `Весь адрес текстом: то, что пишет для него \`JSON.stringify\`.`,
	},
	'URLSearchParams': {
		en: `
			A query's names and values, such as \`id=7&map=de_dust2\`.

			\`\`\`ts
			const query = new URLSearchParams({ id: "7", map: server.map });
			const response = await fetch(\`https://example.com/api?\${query}\`);
			\`\`\`
		`,
		ru: `
			Имена и значения запроса, например \`id=7&map=de_dust2\`.

			\`\`\`ts
			const query = new URLSearchParams({ id: "7", map: server.map });
			const response = await fetch(\`https://example.com/api?\${query}\`);
			\`\`\`
		`,
	},
	'URLSearchParams.size': {
		en: `The number of name and value pairs, a name given twice counted twice.`,
		ru: `Число пар имени и значения; имя, данное дважды, считается дважды.`,
	},
	'URLSearchParams.append': {
		en: `Adds a pair; a name already there keeps its value too.`,
		ru: `Добавляет пару; у имени, которое уже есть, остаётся и прежнее значение.`,
	},
	'URLSearchParams.delete': {
		en: `Removes every pair of \`name\`.`,
		ru: `Убирает все пары с именем \`name\`.`,
	},
	'URLSearchParams.get': {
		en: `The first value of \`name\`, or \`null\` when there is none.`,
		ru: `Первое значение \`name\` или \`null\`, если его нет.`,
	},
	'URLSearchParams.getAll': {
		en: `Every value of \`name\`, in order.`,
		ru: `Все значения \`name\` по порядку.`,
	},
	'URLSearchParams.has': {
		en: `\`true\` when there is a pair of \`name\`.`,
		ru: `\`true\`, если есть пара с именем \`name\`.`,
	},
	'URLSearchParams.set': {
		en: `Sets \`name\` to \`value\`: the first pair takes it, the other pairs of the name go.`,
		ru: `Ставит \`name\` значение \`value\`: его получает первая пара, остальные пары этого имени уходят.`,
	},
	'URLSearchParams.sort': {
		en: `Orders the pairs by name; pairs of one name keep their order.`,
		ru: `Упорядочивает пары по имени; пары одного имени сохраняют свой порядок.`,
	},
	'URLSearchParams.forEach': {
		en: `Calls \`callback\` with each value and its name, in order.`,
		ru: `Вызывает \`callback\` с каждым значением и его именем по порядку.`,
	},
	'URLSearchParams.keys': {
		en: `Every name, in order; a name given twice is there twice.`,
		ru: `Все имена по порядку; имя, данное дважды, встречается дважды.`,
	},
	'URLSearchParams.values': {
		en: `Every value, in order.`,
		ru: `Все значения по порядку.`,
	},
	'URLSearchParams.entries': {
		en: `Every pair as \`[name, value]\`, in order.`,
		ru: `Все пары как \`[name, value]\` по порядку.`,
	},
	'URLSearchParams.toString': {
		en: `The query as text, without the \`?\`: \`id=7&map=de_dust2\`.`,
		ru: `Запрос текстом, без \`?\`: \`id=7&map=de_dust2\`.`,
	},
	'Headers': {
		en: `
			A request's or a response's HTTP headers. Names are matched without
			regard to case.

			\`\`\`ts
			const type = response.headers.get("content-type");
			\`\`\`
		`,
		ru: `
			HTTP-заголовки запроса или ответа. Имена сравниваются без учёта
			регистра.

			\`\`\`ts
			const type = response.headers.get("content-type");
			\`\`\`
		`,
	},
	'Headers.append': {
		en: `Adds a value to \`name\`; one already there stays, and \`get\` joins them.`,
		ru: `Добавляет значение к \`name\`; прежнее остаётся, и \`get\` их объединяет.`,
	},
	'Headers.delete': {
		en: `Removes \`name\` and all its values.`,
		ru: `Убирает \`name\` со всеми его значениями.`,
	},
	'Headers.get': {
		en: `The value of \`name\` - its values joined with \`", "\` when it has several - or \`null\` when there is none.`,
		ru: `Значение \`name\` — несколько значений через \`", "\` — или \`null\`, если такого заголовка нет.`,
	},
	'Headers.getSetCookie': {
		en: `Every \`Set-Cookie\` header of a response, each its own text.`,
		ru: `Все заголовки \`Set-Cookie\` ответа, каждый отдельным текстом.`,
	},
	'Headers.has': {
		en: `\`true\` when there is a header of \`name\`.`,
		ru: `\`true\`, если есть заголовок \`name\`.`,
	},
	'Headers.set': {
		en: `Sets \`name\` to \`value\`, in place of every value it had.`,
		ru: `Ставит \`name\` значение \`value\` вместо всех прежних.`,
	},
	'Headers.forEach': {
		en: `Calls \`callback\` with each header's value and its name in lower case, ordered by name.`,
		ru: `Вызывает \`callback\` со значением каждого заголовка и его именем в нижнем регистре, по порядку имён.`,
	},
	'Headers.keys': {
		en: `Every header's name in lower case, ordered by name.`,
		ru: `Имена всех заголовков в нижнем регистре, по порядку имён.`,
	},
	'Headers.values': {
		en: `Every header's value, ordered by name.`,
		ru: `Значения всех заголовков по порядку имён.`,
	},
	'Headers.entries': {
		en: `Every header as \`[name, value]\`, ordered by name; the values of a name joined, but each \`set-cookie\` on its own.`,
		ru: `Все заголовки как \`[name, value]\` по порядку имён; значения одного имени объединены, но каждый \`set-cookie\` отдельно.`,
	},
	'TlsOptions': {
		en: `The check of a server's certificate, for HTTPS.`,
		ru: `Проверка сертификата сервера при HTTPS.`,
	},
	'TlsOptions.ca': {
		en: `
			The certificate authorities a server's certificate must come from, as
			PEM text - for a server with a certificate of its own making. Left out,
			the authorities a browser trusts.
		`,
		ru: `
			Центры сертификации, от которых должен быть сертификат сервера, текстом
			PEM — для сервера с собственным сертификатом. Если не задано — центры,
			которым доверяет браузер.
		`,
	},
	'RequestInit': {
		en: `A request's options: \`fetch\`'s second argument. Every field is optional.`,
		ru: `Настройки запроса: второй аргумент \`fetch\`. Все поля необязательны.`,
	},
	'RequestInit.method': {
		en: `The request's method, e.g. \`"POST"\`; \`"GET"\` by default.`,
		ru: `Метод запроса, например \`"POST"\`; по умолчанию \`"GET"\`.`,
	},
	'RequestInit.headers': {
		en: `The request's headers, as an object of names and values: \`{ Authorization: "Bearer abc" }\`.`,
		ru: `Заголовки запроса, объектом имён и значений: \`{ Authorization: "Bearer abc" }\`.`,
	},
	'RequestInit.body': {
		en: `The text sent with the request, such as JSON. A GET or HEAD request has none.`,
		ru: `Текст, который уходит с запросом, например JSON. У запроса GET или HEAD его нет.`,
	},
	'RequestInit.redirect': {
		en: `
			The request's answer to a redirect: one of \`"follow"\` (the default) - on
			to its address, \`"manual"\` - the redirect itself as the response, \`"error"\` - a rejection.
		`,
		ru: `
			Поведение запроса при перенаправлении: одно из \`"follow"\` (по умолчанию) — по
			его адресу, \`"manual"\` — само перенаправление ответом, \`"error"\` — отказ.
		`,
	},
	'RequestInit.signal': {
		en: `A signal that cancels the request; the promise then rejects with the signal's reason.`,
		ru: `Сигнал, который отменяет запрос; промис тогда отклоняется с причиной сигнала.`,
	},
	'RequestInit.proxy': {
		en: `A proxy the request goes through, e.g. \`"http://proxy.example.com:3128"\`.`,
		ru: `Прокси, через который идёт запрос, например \`"http://proxy.example.com:3128"\`.`,
	},
	'RequestInit.tls': {
		en: `The check of the server's certificate, for HTTPS.`,
		ru: `Проверка сертификата сервера при HTTPS.`,
	},
	'Request': {
		en: `
			A request: its address, method, headers and body - what \`fetch\` sends.

			\`\`\`ts
			const request = new Request("https://example.com/api", { method: "POST", body: "hi" });
			const response = await fetch(request);
			\`\`\`
		`,
		ru: `
			Запрос: адрес, метод, заголовки и тело — то, что отправляет \`fetch\`.

			\`\`\`ts
			const request = new Request("https://example.com/api", { method: "POST", body: "hi" });
			const response = await fetch(request);
			\`\`\`
		`,
	},
	'Request.url': {
		en: `The address the request goes to.`,
		ru: `Адрес, на который идёт запрос.`,
	},
	'Request.method': {
		en: `The request's method, e.g. \`"GET"\`.`,
		ru: `Метод запроса, например \`"GET"\`.`,
	},
	'Request.headers': {
		en: `The request's headers.`,
		ru: `Заголовки запроса.`,
	},
	'Request.redirect': {
		en: `The request's answer to a redirect: one of \`"follow"\`, \`"manual"\` or \`"error"\`.`,
		ru: `Поведение запроса при перенаправлении: одно из \`"follow"\`, \`"manual"\` или \`"error"\`.`,
	},
	'Request.signal': {
		en: `The signal that cancels the request.`,
		ru: `Сигнал, который отменяет запрос.`,
	},
	'Request.clone': {
		en: `A copy of the request, to send again.`,
		ru: `Копия запроса, чтобы отправить его ещё раз.`,
	},
	'ResponseInit': {
		en: `A response's options: \`new Response\`'s second argument.`,
		ru: `Настройки ответа: второй аргумент \`new Response\`.`,
	},
	'ResponseInit.status': {
		en: `The response's status; \`200\` by default.`,
		ru: `Статус ответа; по умолчанию \`200\`.`,
	},
	'ResponseInit.statusText': {
		en: `The words after the status, e.g. \`"Not Found"\`; \`""\` by default.`,
		ru: `Слова после статуса, например \`"Not Found"\`; по умолчанию \`""\`.`,
	},
	'ResponseInit.headers': {
		en: `The response's headers, as an object of names and values.`,
		ru: `Заголовки ответа, объектом имён и значений.`,
	},
	'Response': {
		en: `
			The server's answer to a request: its status, headers and body.

			\`\`\`ts
			const response = await fetch("https://example.com/api/stats");
			if (!response.ok) return console.log(\`HTTP \${response.status}\`);
			const stats = await response.json<Stats>();
			\`\`\`
		`,
		ru: `
			Ответ сервера на запрос: статус, заголовки и тело.

			\`\`\`ts
			const response = await fetch("https://example.com/api/stats");
			if (!response.ok) return console.log(\`HTTP \${response.status}\`);
			const stats = await response.json<Stats>();
			\`\`\`
		`,
	},
	'Response.status': {
		en: `The response's HTTP status, e.g. \`200\` or \`404\`.`,
		ru: `HTTP-статус ответа, например \`200\` или \`404\`.`,
	},
	'Response.statusText': {
		en: `The words after the status, e.g. \`"Not Found"\`; \`""\` when the server sent none.`,
		ru: `Слова после статуса, например \`"Not Found"\`; \`""\`, если сервер их не прислал.`,
	},
	'Response.ok': {
		en: `\`true\` for a status from \`200\` to \`299\`.`,
		ru: `\`true\` при статусе от \`200\` до \`299\`.`,
	},
	'Response.headers': {
		en: `The response's headers.`,
		ru: `Заголовки ответа.`,
	},
	'Response.url': {
		en: `The address the response came from, after any redirects.`,
		ru: `Адрес, с которого пришёл ответ, после всех перенаправлений.`,
	},
	'Response.redirected': {
		en: `\`true\` when the request was redirected on the way.`,
		ru: `\`true\`, если запрос по пути перенаправили.`,
	},
	'Response.bodyUsed': {
		en: `\`true\` once the body has been read: it can be read once.`,
		ru: `\`true\`, когда тело уже прочитано: прочитать его можно один раз.`,
	},
	'Response.text': {
		en: `The body as text, decoded as UTF-8.`,
		ru: `Тело текстом, в UTF-8.`,
	},
	'Response.json': {
		en: `
			The body read as JSON into \`T\`, an interface of the fields the JSON
			has; rejects with a SyntaxError when it is not JSON.

			\`\`\`ts
			interface Stats {
			  kills: number;
			}
			const stats = await response.json<Stats>();
			\`\`\`
		`,
		ru: `
			Тело, прочитанное как JSON в \`T\` — интерфейс с полями этого JSON;
			отклоняется с SyntaxError, если это не JSON.

			\`\`\`ts
			interface Stats {
			  kills: number;
			}
			const stats = await response.json<Stats>();
			\`\`\`
		`,
	},
	'Response.arrayBuffer': {
		en: `The body as bytes.`,
		ru: `Тело байтами.`,
	},
	'Response.clone': {
		en: `A copy of the response, whose body can be read apart from this one's.`,
		ru: `Копия ответа, тело которой читается отдельно от этого.`,
	},
	'fetch': {
		en: `
			Sends a request and gives its response, as the browser's \`fetch\` does.

			\`\`\`ts
			const response = await fetch("https://example.com/api/stats");
			const stats = await response.json<Stats>();
			\`\`\`

			The promise is fulfilled once the response's headers and body have come,
			on a later server frame: the game does not wait for it. A status such as
			\`404\` is a response too - check \`response.ok\`. The promise rejects with a
			TypeError when there is no response (no connection, a bad address) and
			with the signal's reason when \`init.signal\` aborts. In an async command
			handler or a player's event, the player leaving aborts it too.
		`,
		ru: `
			Отправляет запрос и даёт ответ, как \`fetch\` в браузере.

			\`\`\`ts
			const response = await fetch("https://example.com/api/stats");
			const stats = await response.json<Stats>();
			\`\`\`

			Промис выполняется, когда пришли заголовки и тело ответа, в одном из
			следующих кадров сервера: игра его не ждёт. Статус вроде \`404\` — тоже
			ответ, проверяйте \`response.ok\`. Промис отклоняется с TypeError, если
			ответа нет (нет соединения, плохой адрес), и с причиной сигнала, если
			сработал \`init.signal\`. В async-обработчике команды или события игрока
			запрос отменяется и тогда, когда игрок выходит.
		`,
	},
	'fetch#2': {
		en: `Sends a request to a URL made with \`new URL\`.`,
		ru: `Отправляет запрос по адресу, сделанному через \`new URL\`.`,
	},
	'fetch#3': {
		en: `Sends a request made with \`new Request\`; what \`init\` gives takes the place of the request's own.`,
		ru: `Отправляет запрос, сделанный через \`new Request\`; то, что задаёт \`init\`, заменяет его собственное.`,
	},
	'UseFetchOptions': {
		en: `\`useFetch\`'s options. Every field is optional.`,
		ru: `Настройки \`useFetch\`. Все поля необязательны.`,
	},
	'UseFetchOptions.method': {
		en: `The request's method, e.g. \`"POST"\`; \`"GET"\` by default.`,
		ru: `Метод запроса, например \`"POST"\`; по умолчанию \`"GET"\`.`,
	},
	'UseFetchOptions.query': {
		en: `Names and values added to the URL's query: \`{ page: "2" }\` adds \`?page=2\`.`,
		ru: `Имена и значения, которые добавляются в запрос адреса: \`{ page: "2" }\` добавляет \`?page=2\`.`,
	},
	'UseFetchOptions.headers': {
		en: `The request's headers, as an object of names and values.`,
		ru: `Заголовки запроса, объектом имён и значений.`,
	},
	'UseFetchOptions.body': {
		en: `
			The request's body: text as it is, or an object of the type given second
			(\`useFetch<Answer, Report>\`) as JSON.
		`,
		ru: `
			Тело запроса: текст как есть или объект типа, данного вторым
			(\`useFetch<Answer, Report>\`), — в виде JSON.
		`,
	},
	'UseFetchOptions.retry': {
		en: `The number of further tries when a request fails on the way or the server answers \`5xx\`, \`408\` or \`429\`; \`0\` by default.`,
		ru: `Число повторных попыток, если запрос сорвался по пути или сервер ответил \`5xx\`, \`408\` или \`429\`; по умолчанию \`0\`.`,
	},
	'UseFetchOptions.retryDelay': {
		en: `Milliseconds between two tries; \`500\` by default.`,
		ru: `Миллисекунды между попытками; по умолчанию \`500\`.`,
	},
	'UseFetchOptions.timeout': {
		en: `Milliseconds a try may take before it is given up with a TimeoutError; no limit by default.`,
		ru: `Миллисекунды на одну попытку, после которых её бросают с TimeoutError; по умолчанию без предела.`,
	},
	'UseFetchOptions.signal': {
		en: `A signal that cancels the request.`,
		ru: `Сигнал, который отменяет запрос.`,
	},
	'UseFetchOptions.proxy': {
		en: `A proxy the request goes through, e.g. \`"http://proxy.example.com:3128"\`.`,
		ru: `Прокси, через который идёт запрос, например \`"http://proxy.example.com:3128"\`.`,
	},
	'UseFetchOptions.tls': {
		en: `The check of the server's certificate, for HTTPS.`,
		ru: `Проверка сертификата сервера при HTTPS.`,
	},
	'FetchResult': {
		en: `The answer of \`useFetch\`: the data or the error, and the status.`,
		ru: `Результат \`useFetch\`: данные или ошибка, и статус.`,
	},
	'FetchResult.data': {
		en: `The response's JSON read into \`T\`; \`null\` when there was an error or no body.`,
		ru: `JSON ответа, прочитанный в \`T\`; \`null\`, если была ошибка или тела нет.`,
	},
	'FetchResult.error': {
		en: `Why there is no data: a FetchError for a status that is not \`2xx\`, a TypeError for no response, the signal's reason for an abort, a SyntaxError for a body that is not JSON.`,
		ru: `Почему данных нет: FetchError для статуса не из \`2xx\`, TypeError, если ответа нет, причина сигнала при отмене, SyntaxError для тела, которое не JSON.`,
	},
	'FetchResult.status': {
		en: `The response's HTTP status; \`0\` when there was no response.`,
		ru: `HTTP-статус ответа; \`0\`, если ответа не было.`,
	},
	'FetchError': {
		en: `A response whose status is not \`2xx\`, as \`useFetch\` reports it.`,
		ru: `Ответ со статусом не из \`2xx\`, как о нём сообщает \`useFetch\`.`,
	},
	'FetchError.status': {
		en: `The response's HTTP status, e.g. \`404\`.`,
		ru: `HTTP-статус ответа, например \`404\`.`,
	},
	'FetchError.statusText': {
		en: `The words after the status, e.g. \`"Not Found"\`.`,
		ru: `Слова после статуса, например \`"Not Found"\`.`,
	},
	'FetchError.body': {
		en: `The response's body as text: often what the server says went wrong.`,
		ru: `Тело ответа текстом: часто там сервер пишет, что не так.`,
	},
	'useFetch': {
		en: `
			Sends a request and reads its JSON into \`T\`, an interface of the fields
			the JSON has. It never throws: what went wrong is \`error\`.

			\`\`\`ts
			interface Weather {
			  temperature: number;
			}

			const { data, error } = await useFetch<Weather>("https://example.com/weather", { query: { city: "Paris" } });
			if (error) return console.error(error.message);
			player.print(\`\${data!.temperature} °C\`);
			\`\`\`

			A body that is an object goes as JSON: \`useFetch<Answer, Report>(url, { method: "POST", body: report })\`.
		`,
		ru: `
			Отправляет запрос и читает его JSON в \`T\` — интерфейс с полями этого
			JSON. Никогда не бросает исключение: что пошло не так — в \`error\`.

			\`\`\`ts
			interface Weather {
			  temperature: number;
			}

			const { data, error } = await useFetch<Weather>("https://example.com/weather", { query: { city: "Paris" } });
			if (error) return console.error(error.message);
			player.print(\`\${data!.temperature} °C\`);
			\`\`\`

			Тело-объект уходит как JSON: \`useFetch<Answer, Report>(url, { method: "POST", body: report })\`.
		`,
	},
	'RequestErrorKind': {
		en: `
			Why a request ended without its answer, as \`request\` says it: \`""\` - it
			got one (an HTTP status such as \`404\` is an answer); \`"login"\` - the user,
			password or key was refused; \`"denied"\` - the account may not do it (FTP
			cannot enter a folder, SFTP says permission denied); \`"notFound"\` - no
			such remote file; \`"refused"\` - no connection: the host is unknown or
			refuses it; \`"timeout"\` - \`timeout\` ran out; \`"tls"\` - the secure
			connection failed: a certificate, or an SSH host key, not trusted;
			\`"aborted"\` - the signal aborted it; \`"other"\` - anything else, said in
			\`errorText\`.
		`,
		ru: `
			Почему запрос закончился без ответа, как это говорит \`request\`: \`""\` —
			ответ есть (HTTP-статус вроде \`404\` — тоже ответ); \`"login"\` —
			пользователь, пароль или ключ не приняты; \`"denied"\` — учётной записи это
			нельзя (FTP не может войти в папку, SFTP отвечает «нет прав»);
			\`"notFound"\` — такого файла на сервере нет; \`"refused"\` — нет соединения:
			хост неизвестен или отказывает; \`"timeout"\` — вышло время \`timeout\`;
			\`"tls"\` — не удалось защищённое соединение: сертификату или ключу хоста
			SSH нет доверия; \`"aborted"\` — запрос прервал сигнал; \`"other"\` — всё
			остальное, словами в \`errorText\`.
		`,
	},
	'RequestOptions': {
		en: `
			\`request\`'s options: what to send and how. Every field is optional; the
			URL's scheme - \`http:\`, \`https:\`, \`ftp:\`, \`ftps:\` or \`sftp:\` - says which
			of them apply.
		`,
		ru: `
			Параметры \`request\`: что отправить и как. Все поля необязательны; схема
			адреса — \`http:\`, \`https:\`, \`ftp:\`, \`ftps:\` или \`sftp:\` — решает, какие
			из них действуют.
		`,
	},
	'RequestOptions.method': {
		en: `HTTP's method, e.g. \`"POST"\`; \`"GET"\` by default. \`"HEAD"\` transfers nothing - with \`quote\`, only the commands run.`,
		ru: `Метод HTTP, например \`"POST"\`; по умолчанию \`"GET"\`. \`"HEAD"\` ничего не передаёт — с \`quote\` выполняются только команды.`,
	},
	'RequestOptions.headers': {
		en: `HTTP's headers, as an object of names and values.`,
		ru: `Заголовки HTTP — объект имён и значений.`,
	},
	'RequestOptions.body': {
		en: `The text sent: HTTP's body, or - with \`upload\` - the file's content.`,
		ru: `Отправляемый текст: тело HTTP или — с \`upload\` — содержимое файла.`,
	},
	'RequestOptions.user': {
		en: `The user to log in as; the URL's own (\`ftp://user@host\`) when left out.`,
		ru: `Пользователь для входа; если не задан — тот, что в адресе (\`ftp://user@host\`).`,
	},
	'RequestOptions.password': {
		en: `The password to log in with.`,
		ru: `Пароль для входа.`,
	},
	'RequestOptions.keyFile': {
		en: `
			SFTP: the private key to log in with, a file of the game folder
			(\`addons/amxmodx/data/id_rsa\`) - an RSA key in PEM
			(\`ssh-keygen -t rsa -m PEM\`).
		`,
		ru: `
			SFTP: закрытый ключ для входа, файл игровой папки
			(\`addons/amxmodx/data/id_rsa\`) — ключ RSA в PEM
			(\`ssh-keygen -t rsa -m PEM\`).
		`,
	},
	'RequestOptions.keyPassphrase': {
		en: `SFTP: the passphrase \`keyFile\` is encrypted with.`,
		ru: `SFTP: пароль, которым зашифрован \`keyFile\`.`,
	},
	'RequestOptions.hostKey': {
		en: `
			SFTP: the server's host key, its SHA-256 fingerprint in base64 as
			\`ssh-keygen -lf\` prints it without \`SHA256:\` - a server with another key
			is refused (\`"tls"\`). Left out, any host key is taken.
		`,
		ru: `
			SFTP: ключ хоста сервера — его отпечаток SHA-256 в base64, как его печатает
			\`ssh-keygen -lf\`, без \`SHA256:\`; сервер с другим ключом отвергается
			(\`"tls"\`). Если не задан, принимается любой ключ хоста.
		`,
	},
	'RequestOptions.ssl': {
		en: `
			FTP: TLS asked for with \`AUTH TLS\` on a plain \`ftp:\` connection - one of
			\`"try"\` (when the server has it), \`"control"\` (the commands at least)
			or \`"all"\` (the commands and the files, or fail). \`ftps:\` is TLS from
			the first byte without it.
		`,
		ru: `
			FTP: TLS, запрошенный через \`AUTH TLS\` на обычном соединении \`ftp:\`, —
			\`"try"\` (если сервер умеет), \`"control"\` (хотя бы команды) или
			\`"all"\` (команды и файлы, иначе ошибка). \`ftps:\` — TLS с первого байта
			и без этого параметра.
		`,
	},
	'RequestOptions.upload': {
		en: `Sends \`body\` - or \`file\` - to the URL's path, in place of reading it: an FTP or SFTP upload, an HTTP PUT.`,
		ru: `Отправляет \`body\` — или \`file\` — по пути адреса вместо чтения: загрузка на FTP или SFTP, HTTP PUT.`,
	},
	'RequestOptions.list': {
		en: `FTP and SFTP: the names in the URL's folder, one a line, in place of a listing with sizes and dates.`,
		ru: `FTP и SFTP: имена в папке адреса, по одному в строке, вместо списка с размерами и датами.`,
	},
	'RequestOptions.quote': {
		en: `FTP or SFTP commands run before the transfer, in order: \`["DELE old.txt"]\`, \`["rename a.txt b.txt"]\`.`,
		ru: `Команды FTP или SFTP, выполняемые по порядку до передачи: \`["DELE old.txt"]\`, \`["rename a.txt b.txt"]\`.`,
	},
	'RequestOptions.createDirs': {
		en: `FTP and SFTP: an upload makes the folders of its path that are not there.`,
		ru: `FTP и SFTP: загрузка создаёт недостающие папки своего пути.`,
	},
	'RequestOptions.timeout': {
		en: `Milliseconds the whole request may take; past them it ends as \`"timeout"\`. No limit by default.`,
		ru: `Время в миллисекундах, которое может идти весь запрос; дольше — он заканчивается как \`"timeout"\`. По умолчанию без ограничения.`,
	},
	'RequestOptions.signal': {
		en: `A signal that aborts the request: it then ends at once as \`"aborted"\`.`,
		ru: `Сигнал, прерывающий запрос: тогда он сразу заканчивается как \`"aborted"\`.`,
	},
	'RequestOptions.file': {
		en: `
			A file of the game folder (\`maps/de_dust2.bsp\`) the answer is written
			into - or, with \`upload\`, the upload is read from - in place of \`body\`.
			The bytes go between the network and the disk without passing through
			the plugin. A download that fails leaves an older file of that name as
			it was. A path outside the game folder (absolute, or with \`..\`) is
			refused.
		`,
		ru: `
			Файл игровой папки (\`maps/de_dust2.bsp\`), в который пишется ответ, —
			или, с \`upload\`, из которого читается загрузка, — вместо \`body\`.
			Байты идут между сетью и диском, не проходя через плагин. Неудачная
			закачка оставляет прежний файл с этим именем как был. Путь вне игровой
			папки (абсолютный или с \`..\`) отвергается.
		`,
	},
	'RequestOptions.follow': {
		en: `HTTP: whether a redirect is followed; \`true\` by default.`,
		ru: `HTTP: идти ли по перенаправлению; по умолчанию \`true\`.`,
	},
	'RequestOptions.proxy': {
		en: `A proxy the request goes through, e.g. \`"http://proxy.example.com:3128"\`.`,
		ru: `Прокси, через который идёт запрос, например \`"http://proxy.example.com:3128"\`.`,
	},
	'RequestOptions.ca': {
		en: `The certificate authorities a server's certificate must come from, as PEM text; the ones a browser trusts by default.`,
		ru: `Удостоверяющие центры, от которых должен быть сертификат сервера, текстом PEM; по умолчанию — те, которым доверяет браузер.`,
	},
	'RequestResult': {
		en: `The end of a request: its answer, or why there is none.`,
		ru: `Итог запроса: его ответ или почему ответа нет.`,
	},
	'RequestResult.status': {
		en: `HTTP's status, or FTP's last reply once the transfer is done (\`226\`); \`0\` for SFTP; \`-1\` when the request failed.`,
		ru: `Статус HTTP или последний ответ FTP после передачи (\`226\`); \`0\` для SFTP; \`-1\`, если запрос не удался.`,
	},
	'RequestResult.errorKind': {
		en: `Why there is no answer, or \`""\`.`,
		ru: `Почему нет ответа, или \`""\`.`,
	},
	'RequestResult.errorText': {
		en: `The failure, in words; \`""\` when there was none.`,
		ru: `Неудача словами; \`""\`, если её не было.`,
	},
	'RequestResult.replyCode': {
		en: `The protocol's last reply code, a failed request's too: HTTP's status, FTP's reply (\`530\`, \`550\`), SFTP's status (\`2\` no such file); \`0\` when there was none.`,
		ru: `Последний код ответа протокола, и у неудавшегося запроса: статус HTTP, ответ FTP (\`530\`, \`550\`), статус SFTP (\`2\` — нет такого файла); \`0\`, если его не было.`,
	},
	'RequestResult.statusText': {
		en: `The words after HTTP's status, e.g. \`"Not Found"\`.`,
		ru: `Слова после статуса HTTP, например \`"Not Found"\`.`,
	},
	'RequestResult.headers': {
		en: `HTTP's response headers.`,
		ru: `Заголовки ответа HTTP.`,
	},
	'RequestResult.body': {
		en: `The answer's bytes - a download, a listing; empty when it went into \`file\`.`,
		ru: `Байты ответа — скачанное, список; пусто, если ответ ушёл в \`file\`.`,
	},
	'RequestResult.url': {
		en: `The address the answer came from, after any redirects.`,
		ru: `Адрес, откуда пришёл ответ, после всех перенаправлений.`,
	},
	'RequestResult.redirected': {
		en: `\`true\` when an HTTP redirect was followed on the way.`,
		ru: `\`true\`, если по пути было перенаправление HTTP.`,
	},
	'RequestResult.text': {
		en: `The answer as text, decoded as UTF-8.`,
		ru: `Ответ текстом, декодированный как UTF-8.`,
	},
	'request': {
		en: `
			Sends a request to \`url\` - HTTP, HTTPS, FTP, FTPS or SFTP - with the
			server's network client, and gives what it ended with. It never rejects:
			a failure is \`errorKind\` and \`errorText\`.

			\`\`\`ts
			import { request } from "@amxts/core/kit";

			const result = await request("sftp://example.com/maps/de_dust2.bsp", {
			  user: "admin",
			  keyFile: "addons/amxmodx/data/id_rsa",
			  upload: true,
			  file: "maps/de_dust2.bsp",
			});
			if (result.errorKind != "") console.error(\`\${result.errorKind}: \${result.errorText}\`);
			\`\`\`

			The promise settles on a later server frame: the game does not wait. In an
			async command handler or a player's event, the player leaving aborts it.
		`,
		ru: `
			Отправляет запрос по \`url\` — HTTP, HTTPS, FTP, FTPS или SFTP — сетевым
			клиентом сервера и даёт то, чем он закончился. Никогда не отклоняется:
			неудача — это \`errorKind\` и \`errorText\`.

			\`\`\`ts
			import { request } from "@amxts/core/kit";

			const result = await request("sftp://example.com/maps/de_dust2.bsp", {
			  user: "admin",
			  keyFile: "addons/amxmodx/data/id_rsa",
			  upload: true,
			  file: "maps/de_dust2.bsp",
			});
			if (result.errorKind != "") console.error(\`\${result.errorKind}: \${result.errorText}\`);
			\`\`\`

			Промис выполняется в одном из следующих кадров сервера: игра не ждёт. В
			async-обработчике команды или события игрока уход игрока прерывает запрос.
		`,
	},
};
