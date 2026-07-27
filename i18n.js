/**
 * LotChance i18n — English / Spanish.
 *
 * Loads before app.js. Exposes window.I18N and a global t(key, params).
 * - First launch: shows a bilingual language picker overlay.
 * - Later: the header globe button (id="langSwitcher") reopens the picker.
 * - Choice persists in localStorage ('lotchance.lang').
 * - Static HTML is translated via [data-i18n] / [data-i18n-placeholder]
 *   attributes; dynamic JS strings call t() at render time.
 */
(function () {
    const translations = {
        en: {
            'header.subtitle': 'Texas Scratch-Off Analyzer',
            'header.locationPlaceholder': 'Enter City or ZIP Code',
            'header.setLocation': 'Set Location',

            'dash.title': 'Dashboard Statistics',
            'dash.activeGames': 'Active Games',
            'dash.totalTopPrizes': 'Total Top Prizes Available',
            'dash.bestOdds': 'Best Overall Odds',
            'dash.topPrizesWon': 'Top Prizes Already Won',
            'dash.highestJackpot': 'Highest Jackpot:',
            'dash.priceRange': 'Price Range:',
            'dash.bestValue': 'Best Value Pick:',
            'dash.dataUpdated': 'Data Updated:',
            'dash.loading': 'Loading...',

            'refresh.on': 'Auto-refresh: ON',
            'refresh.off': 'Auto-refresh: OFF',
            'refresh.nextUpdate': 'Next update in:',
            'refresh.interval': 'Refresh Interval:',
            'refresh.sec5': '5 seconds',
            'refresh.sec10': '10 seconds',
            'refresh.sec30': '30 seconds',
            'refresh.min1': '1 minute',
            'refresh.min5': '5 minutes',
            'refresh.start': 'Start Auto-Refresh',
            'refresh.stop': 'Stop Auto-Refresh',
            'refresh.now': 'Refresh Now',

            'picks.title': "Today's Top 5 Picks",
            'picks.live': 'LIVE',
            'picks.jackpotOdds': 'Best Jackpot + Odds',
            'picks.jackpotOddsSub': 'Highest prizes with best chances',
            'picks.winningOdds': 'Best Winning Odds',
            'picks.winningOddsSub': 'Easiest to win any prize',
            'picks.budget': 'Best Budget Value',
            'picks.budgetSub': 'Best return for your money',
            'picks.leftFrac': '{r}/{t} left',
            'picks.odds': '1:{o} odds',
            'picks.prizesLeftPct': '{p}% prizes left',

            'insights.title': 'Smart Insights',
            'insights.allLeft': '<strong>{n} games</strong> have all top prizes still available! Best picks: {names}',
            'insights.allLeftLabel': '{n} games with all top prizes remaining',
            'insights.low': '<strong>{n} games</strong> have less than 25% of top prizes left. Consider avoiding: {names}',
            'insights.lowLabel': '{n} games with less than 25% top prizes left',
            'insights.bestAtPrice': 'Best ${price} game: <strong>{name}</strong> with 1:{odds} odds',
            'insights.bestAtPriceLabel': 'All {n} games at ${price} price point (sorted by odds)',
            'insights.highestValue': 'Highest value score: <strong>{name}</strong> (${price}) - great balance of prize, odds, and remaining jackpots',
            'insights.highestValueLabel': 'Top 10 games by value score',
            'insights.clickToFilter': 'Click to filter games',
            'insights.filterPrefix': 'Insight Filter: {label}',

            'nearme.title': 'Near Me Mode',
            'nearme.detect': 'Detect My Location',
            'nearme.noLocation': 'No location set',
            'nearme.radiusLabel': 'Search Radius:',
            'nearme.miles': 'miles',
            'nearme.info': 'Enable Near Me mode to find lottery retailers within your chosen radius. All scratch-off games are available at any Texas Lottery retailer.',
            'nearme.detecting': 'Detecting location...',
            'nearme.detectFailed': 'Location detection failed. Try entering a ZIP in the header.',
            'nearme.detectFailedNotif': 'Could not detect location. Check browser permissions.',
            'nearme.searching': 'Searching Texas Lottery retailers within {r} miles...',
            'nearme.none': 'No retailers found within {r} miles',
            'nearme.noneHint': 'Try increasing the radius using the slider above',
            'nearme.foundOne': '<strong>1 lottery retailer</strong> found within {r} miles{src}',
            'nearme.foundMany': '<strong>{n} lottery retailers</strong> found within {r} miles{src}',
            'nearme.allAvailable': 'All Texas scratch-off games are available at these locations',
            'nearme.nearby': 'nearby',
            'nearme.noRetailersInRadius': 'No retailers within {r} miles',
            'nearme.increaseRadius': 'Increase the radius slider in "Near Me Mode" above to find stores that sell scratch-off tickets.',
            'nearme.storesWithin': '{n} stores within {r} mi',

            'filters.title': 'Filter & Sort Tickets',
            'filters.priceRange': 'Price Range',
            'filters.allPrices': 'All Prices',
            'filters.sortBy': 'Sort By',
            'filters.sortAdjusted': 'Best Adjusted Odds',
            'filters.sortOverall': 'Best Overall Odds',
            'filters.sortJackpot': 'Highest Jackpot',
            'filters.sortPriceAsc': 'Price (Low to High)',
            'filters.sortPriceDesc': 'Price (High to Low)',
            'filters.sortRemaining': 'Most Jackpots Remaining',
            'filters.sortValue': 'Best Value Score',
            'filters.jackpotStatus': 'Jackpot Status',
            'filters.allGames': 'All Games',
            'filters.hasJackpots': 'Has Jackpots Left',
            'filters.most50': '50%+ Jackpots Left',
            'filters.allJackpots': 'All Jackpots Available',
            'filters.gameType': 'Game Type',
            'filters.allTypes': 'All Types',
            'filters.multiplier': 'Multiplier Games',
            'filters.crossword': 'Crossword/Word Games',
            'filters.loteria': 'Loteria',
            'filters.bingo': 'Bingo',
            'filters.themed': 'Themed (Sports, Movies)',
            'filters.apply': 'Apply Filters',
            'filters.reset': 'Reset',

            'nav.stats': 'Stats',
            'nav.picks': 'Picks',
            'nav.nearMe': 'Near Me',
            'nav.filters': 'Filter',
            'nav.tickets': 'Tickets',
            'nav.stats': 'Stats',
            'nav.picks': 'Picks',
            'nav.nearMe': 'Near Me',
            'nav.filters': 'Filter',
            'nav.tickets': 'Tickets',
            'games.title': 'Available Scratch-Off Tickets',
            'games.showing': 'Showing',
            'games.of': 'of',
            'games.games': 'games',
            'games.clearFilter': 'Clear Filter',
            'games.noMatch': 'No games match your filters. Try adjusting your criteria.',

            'card.allPrizesLeft': 'All Prizes Left',
            'card.limited': 'Limited',
            'card.noJackpots': 'No Jackpots',
            'card.closing': 'Closing {d}',
            'card.pulled': 'Leaving Stores',
            'modal.closingWarning': 'This game is scheduled to close on {d}. Retailers will stop selling it soon and it may already be hard to find — check availability before heading out.',
            'modal.pulledWarning': 'This game has been called for closing and is being removed from stores now (final sales date {d}). It may no longer be available near you.',
            'card.topPrize': 'Top Prize',
            'card.overallOdds': 'Overall Odds',
            'card.topPrizesRemaining': 'Top Prizes Remaining',
            'card.ofWon': '{r} of {t} ({c} won)',
            'card.adjustedOdds': 'Adjusted Jackpot Odds',
            'card.basedOn': 'Based on {r} remaining top prizes',
            'card.findNearby': 'Find Nearby',
            // Near Me is a general retailer search — it is not filtered by game,
            // so this must not claim the specific game is stocked there. Use
            // "Find Nearby" on the card for the game-specific answer.
            'card.availableOne': '1 lottery store within {r} mi',
            'card.availableMany': '{n} lottery stores within {r} mi',
            'card.nearest': 'nearest: {name} ({dist})',
            'card.checkStock': 'tap Find Nearby to see who stocks this game',

            'value.excellent': 'Excellent',
            'value.good': 'Good',
            'value.fair': 'Fair',
            'value.poor': 'Poor',
            'value.withSuffix': '{label} Value',

            'type.standard': 'standard',
            'type.multiplier': 'multiplier',
            'type.crossword': 'crossword',
            'type.loteria': 'loteria',
            'type.bingo': 'bingo',
            'type.themed': 'themed',

            'modal.perTicket': 'per ticket',
            'modal.gameNumber': 'Game #{id} | {type}',
            'modal.topPrizeSuffix': '{amount} Top Prize',
            'modal.keyStats': 'Key Statistics',
            'modal.oneIn': '1 in {o}',
            'modal.xOfY': '{r} of {t}',
            'modal.topPrizesClaimed': 'Top Prizes Claimed',
            'modal.won': '{c} won',
            'modal.jackpotStatus': 'Jackpot Status',
            'modal.pctRemaining': '{p}% of top prizes remaining',
            'modal.warning': '{c} of {t} top prizes have already been won. Your effective odds of winning the top prize are reduced.',
            'modal.prizeBreakdown': 'Prize Breakdown',
            'modal.prizeAmount': 'Prize Amount',
            'modal.remaining': 'Remaining',
            'modal.odds': 'Odds',
            'modal.findWhere': 'Find Where to Buy',
            'modal.officialDetails': 'Official Details',

            'retailer.title': 'Find Nearby Retailers',
            'retailer.findWhereToBuy': 'Find where to buy',
            'retailer.useMyLocation': 'Use My Location',
            'retailer.or': 'or',
            'retailer.zipPlaceholder': 'Enter ZIP Code',
            'retailer.cityPlaceholder': 'Enter City (e.g. Houston)',
            'retailer.search': 'Search',
            'retailer.loadingMap': 'Loading map...',
            'retailer.nearbyList': 'Nearby Lottery Retailers',
            'retailer.usePrompt': 'Use your location or search to find nearby retailers',
            'retailer.tips': 'Tips',
            'retailer.tip1': 'Click a marker on the map to see retailer details',
            'retailer.tip2': 'Not all retailers carry every scratch-off game',
            'retailer.tip3': 'Call ahead to confirm specific ticket availability',
            'retailer.official': 'Official TX Lottery Locator',
            'retailer.locating': 'Locating…',
            'retailer.searchingRetailers': 'Searching Texas Lottery retailers...',
            'retailer.searchingList': 'Searching nearby Texas Lottery retailers…',
            'retailer.gettingLocation': 'Getting your location...',
            'retailer.notifNoZipCity': 'Please enter a ZIP code or city',
            'retailer.notFound': 'Location not found. Try a different search.',
            'retailer.searchError': 'Error searching retailers: {msg}',
            'retailer.geoUnsupported': 'Geolocation not supported by your browser',
            'retailer.geoFailed': 'Could not get your location. Please enter a ZIP or city.',
            'retailer.yourLocation': 'Your Location',
            'retailer.searchLocation': 'Search Location',
            'retailer.mapCenter': 'Map center',
            'retailer.defaultName': 'Lottery Retailer',
            'retailer.carries': 'Sold here recently',
            'retailer.soldAsOf': 'Last sold here {when}',
            'retailer.stockCaveat': 'Stores report which games they stock; nobody publishes live inventory, so a listed store can still be sold out. Call ahead for a long trip.',
            'retailer.general': 'General lottery',
            'retailer.generalFull': 'General lottery retailer',
            'retailer.noAddress': 'Address not available',
            'retailer.directions': 'Directions',
            'retailer.getDirections': 'Get Directions',
            'retailer.milesAway': '{d} miles away',
            'retailer.milesApprox': '~{d} miles away',
            'retailer.placingPins': 'List ready — pinpointing exact locations on the map...',
            'retailer.zipClusterTitle': '{n} stores in ZIP {zip}',
            'retailer.zipClusterNote': 'Approximate — pinned at the centre of the ZIP code. Exact pins appear as addresses are confirmed.',
            'retailer.andMore': '+{n} more',
            'retailer.nRetailersNearby': '{n} retailers nearby',
            'retailer.showingNofTotal': 'showing nearest {n} of {total} found',
            'retailer.dataAsOf': 'Store data as of {when} ({age})',
            'retailer.nameNote': 'Store names are as registered with the Texas Lottery. The sign outside may show a different brand — many are fuel-branded, so a store listed here under its business name can be the Valero or Shell you know it as.',
            'retailer.nConfirmed': '{n} confirmed to carry this game',
            'retailer.noneInArea': 'No lottery retailers found in this area.',
            'retailer.tryDifferent': 'Try a different ZIP code or city.',
            'retailer.errCouldntLoad': "Couldn't load retailers — Texas Lottery returned an error ({msg})",
            'retailer.errNoneNear': 'No lottery retailers found near {loc}.',
            'retailer.carriersOne': '1 retailer carries "{game}" within ~{r} mi',
            'retailer.carriersMany': '{n} retailers carry "{game}" within ~{r} mi',
            'retailer.noCarrier': 'No retailer in this area reports carrying "{game}". Showing {n} general lottery retailers.',
            'retailer.foundN': 'Found {n} lottery retailers',
            'retailer.showingWithin': 'Showing {n} retailers within {r} miles',
            'retailer.thisLocation': 'this location',

            'app.loadingData': 'Loading lottery data...',
            'app.usingCached': 'Using cached data - start server for live updates',
            'app.usingCachedAge': 'Offline — showing data from {age}. Start the server for live updates.',
            'app.bundledSnapshot': 'the bundled snapshot',
            'age.minutes': '{n} min ago',
            'age.hours': '{n} hours ago',
            'age.days': '{n} days ago',
            'dash.unknownDate': 'unknown — never refreshed',
            'dash.sourceLabel': 'Source: {src}',
            'dash.source.live': 'live from Texas Lottery',
            'dash.source.cache': 'saved copy (offline)',
            'dash.source.bundled': 'app snapshot (never refreshed)',
            'dash.staleHint': 'more than a day old; prize counts may have changed',
            'app.refreshFailed': 'Failed to refresh - using cached data',
            'app.gameDataUnavailable': 'Game data not available',
            'app.locationSet': 'Location set to: {loc}',

            'footer.line1': 'This app is for informational purposes only. Play responsibly.',
            'footer.line2': 'Data sourced from Texas Lottery. Must be 18+ to play.',
            'footer.disclaimer': 'Odds shown are calculated estimates. Actual odds may vary. Always check official sources.'
        },
        es: {
            'header.subtitle': 'Analizador de Raspaditos de Texas',
            'header.locationPlaceholder': 'Ciudad o código postal',
            'header.setLocation': 'Fijar ubicación',

            'dash.title': 'Estadísticas generales',
            'dash.activeGames': 'Juegos activos',
            'dash.totalTopPrizes': 'Total de premios mayores disponibles',
            'dash.bestOdds': 'Mejores probabilidades globales',
            'dash.topPrizesWon': 'Premios mayores ya ganados',
            'dash.highestJackpot': 'Premio más alto:',
            'dash.priceRange': 'Rango de precios:',
            'dash.bestValue': 'Mejor valor:',
            'dash.dataUpdated': 'Datos actualizados:',
            'dash.loading': 'Cargando...',

            'refresh.on': 'Auto-actualización: SÍ',
            'refresh.off': 'Auto-actualización: NO',
            'refresh.nextUpdate': 'Próxima actualización en:',
            'refresh.interval': 'Intervalo de actualización:',
            'refresh.sec5': '5 segundos',
            'refresh.sec10': '10 segundos',
            'refresh.sec30': '30 segundos',
            'refresh.min1': '1 minuto',
            'refresh.min5': '5 minutos',
            'refresh.start': 'Iniciar auto-actualización',
            'refresh.stop': 'Detener auto-actualización',
            'refresh.now': 'Actualizar ahora',

            'picks.title': 'Los 5 mejores de hoy',
            'picks.live': 'EN VIVO',
            'picks.jackpotOdds': 'Mejor premio + probabilidad',
            'picks.jackpotOddsSub': 'Premios más altos con mejores probabilidades',
            'picks.winningOdds': 'Mejores probabilidades de ganar',
            'picks.winningOddsSub': 'Más fácil de ganar cualquier premio',
            'picks.budget': 'Mejor valor por tu dinero',
            'picks.budgetSub': 'Mejor retorno por tu dinero',
            'picks.leftFrac': '{r}/{t} restantes',
            'picks.odds': 'probabilidad 1:{o}',
            'picks.prizesLeftPct': '{p}% de premios restantes',

            'insights.title': 'Análisis inteligente',
            'insights.allLeft': '¡<strong>{n} juegos</strong> aún tienen todos los premios mayores disponibles! Mejores opciones: {names}',
            'insights.allLeftLabel': '{n} juegos con todos los premios mayores restantes',
            'insights.low': '<strong>{n} juegos</strong> tienen menos del 25% de los premios mayores. Considera evitar: {names}',
            'insights.lowLabel': '{n} juegos con menos del 25% de premios mayores restantes',
            'insights.bestAtPrice': 'Mejor juego de ${price}: <strong>{name}</strong> con probabilidad 1:{odds}',
            'insights.bestAtPriceLabel': 'Los {n} juegos de ${price} (ordenados por probabilidad)',
            'insights.highestValue': 'Mayor puntuación de valor: <strong>{name}</strong> (${price}): gran equilibrio entre premio, probabilidad y premios restantes',
            'insights.highestValueLabel': 'Los 10 mejores juegos por puntuación de valor',
            'insights.clickToFilter': 'Haz clic para filtrar juegos',
            'insights.filterPrefix': 'Filtro de análisis: {label}',

            'nearme.title': 'Modo Cerca de mí',
            'nearme.detect': 'Detectar mi ubicación',
            'nearme.noLocation': 'Sin ubicación',
            'nearme.radiusLabel': 'Radio de búsqueda:',
            'nearme.miles': 'millas',
            'nearme.info': 'Activa el modo Cerca de mí para encontrar puntos de venta de lotería dentro del radio elegido. Todos los raspaditos están disponibles en cualquier punto de venta de la Lotería de Texas.',
            'nearme.detecting': 'Detectando ubicación...',
            'nearme.detectFailed': 'No se pudo detectar la ubicación. Ingresa un código postal arriba.',
            'nearme.detectFailedNotif': 'No se pudo detectar la ubicación. Revisa los permisos del navegador.',
            'nearme.searching': 'Buscando puntos de venta de la Lotería de Texas en un radio de {r} millas...',
            'nearme.none': 'No se encontraron puntos de venta en {r} millas',
            'nearme.noneHint': 'Intenta aumentar el radio con el control de arriba',
            'nearme.foundOne': '<strong>1 punto de venta</strong> encontrado en un radio de {r} millas{src}',
            'nearme.foundMany': '<strong>{n} puntos de venta</strong> encontrados en un radio de {r} millas{src}',
            'nearme.allAvailable': 'Todos los raspaditos de Texas están disponibles en estos lugares',
            'nearme.nearby': 'cerca',
            'nearme.noRetailersInRadius': 'No hay puntos de venta en {r} millas',
            'nearme.increaseRadius': 'Aumenta el radio en el "Modo Cerca de mí" arriba para encontrar tiendas que vendan raspaditos.',
            'nearme.storesWithin': '{n} tiendas en {r} mi',

            'filters.title': 'Filtrar y ordenar boletos',
            'filters.priceRange': 'Rango de precio',
            'filters.allPrices': 'Todos los precios',
            'filters.sortBy': 'Ordenar por',
            'filters.sortAdjusted': 'Mejor probabilidad ajustada',
            'filters.sortOverall': 'Mejor probabilidad global',
            'filters.sortJackpot': 'Premio más alto',
            'filters.sortPriceAsc': 'Precio (menor a mayor)',
            'filters.sortPriceDesc': 'Precio (mayor a menor)',
            'filters.sortRemaining': 'Más premios mayores restantes',
            'filters.sortValue': 'Mejor puntuación de valor',
            'filters.jackpotStatus': 'Estado del premio mayor',
            'filters.allGames': 'Todos los juegos',
            'filters.hasJackpots': 'Con premios mayores restantes',
            'filters.most50': '50%+ de premios restantes',
            'filters.allJackpots': 'Todos los premios disponibles',
            'filters.gameType': 'Tipo de juego',
            'filters.allTypes': 'Todos los tipos',
            'filters.multiplier': 'Juegos de multiplicador',
            'filters.crossword': 'Crucigramas/Palabras',
            'filters.loteria': 'Lotería',
            'filters.bingo': 'Bingo',
            'filters.themed': 'Temáticos (deportes, películas)',
            'filters.apply': 'Aplicar filtros',
            'filters.reset': 'Restablecer',

            'nav.stats': 'Datos',
            'nav.picks': 'Top 5',
            'nav.nearMe': 'Cerca',
            'nav.filters': 'Filtrar',
            'nav.tickets': 'Boletos',
            'games.title': 'Raspaditos disponibles',
            'games.showing': 'Mostrando',
            'games.of': 'de',
            'games.games': 'juegos',
            'games.clearFilter': 'Quitar filtro',
            'games.noMatch': 'Ningún juego coincide con tus filtros. Ajusta los criterios.',

            'card.allPrizesLeft': 'Todos los premios',
            'card.limited': 'Limitado',
            'card.noJackpots': 'Sin premios mayores',
            'card.closing': 'Cierra {d}',
            'card.pulled': 'Saliendo de tiendas',
            'modal.closingWarning': 'Este juego cerrará el {d}. Pronto dejará de venderse y puede ser difícil de encontrar — verifica la disponibilidad antes de salir.',
            'modal.pulledWarning': 'Este juego fue llamado a cierre y se está retirando de las tiendas (última fecha de venta {d}). Es posible que ya no esté disponible cerca de ti.',
            'card.topPrize': 'Premio mayor',
            'card.overallOdds': 'Probabilidad global',
            'card.topPrizesRemaining': 'Premios mayores restantes',
            'card.ofWon': '{r} de {t} ({c} ganados)',
            'card.adjustedOdds': 'Probabilidad ajustada del premio mayor',
            'card.basedOn': 'Basado en {r} premios mayores restantes',
            'card.findNearby': 'Buscar cerca',
            'card.availableOne': '1 tienda de lotería a {r} mi',
            'card.availableMany': '{n} tiendas de lotería a {r} mi',
            'card.nearest': 'más cercana: {name} ({dist})',
            'card.checkStock': 'toca Buscar cerca para ver quién tiene este juego',

            'value.excellent': 'Excelente',
            'value.good': 'Bueno',
            'value.fair': 'Regular',
            'value.poor': 'Bajo',
            'value.withSuffix': 'Valor {label}',

            'type.standard': 'estándar',
            'type.multiplier': 'multiplicador',
            'type.crossword': 'crucigrama',
            'type.loteria': 'lotería',
            'type.bingo': 'bingo',
            'type.themed': 'temático',

            'modal.perTicket': 'por boleto',
            'modal.gameNumber': 'Juego #{id} | {type}',
            'modal.topPrizeSuffix': 'Premio mayor de {amount}',
            'modal.keyStats': 'Estadísticas clave',
            'modal.oneIn': '1 en {o}',
            'modal.xOfY': '{r} de {t}',
            'modal.topPrizesClaimed': 'Premios mayores reclamados',
            'modal.won': '{c} ganados',
            'modal.jackpotStatus': 'Estado del premio mayor',
            'modal.pctRemaining': '{p}% de premios mayores restantes',
            'modal.warning': 'Ya se ganaron {c} de {t} premios mayores. Tus probabilidades efectivas de ganar el premio mayor son menores.',
            'modal.prizeBreakdown': 'Desglose de premios',
            'modal.prizeAmount': 'Monto del premio',
            'modal.remaining': 'Restantes',
            'modal.odds': 'Probabilidad',
            'modal.findWhere': 'Dónde comprar',
            'modal.officialDetails': 'Detalles oficiales',

            'retailer.title': 'Buscar puntos de venta cercanos',
            'retailer.findWhereToBuy': 'Dónde comprar',
            'retailer.useMyLocation': 'Usar mi ubicación',
            'retailer.or': 'o',
            'retailer.zipPlaceholder': 'Código postal',
            'retailer.cityPlaceholder': 'Ciudad (ej. Houston)',
            'retailer.search': 'Buscar',
            'retailer.loadingMap': 'Cargando mapa...',
            'retailer.nearbyList': 'Puntos de venta cercanos',
            'retailer.usePrompt': 'Usa tu ubicación o busca para encontrar puntos de venta cercanos',
            'retailer.tips': 'Consejos',
            'retailer.tip1': 'Toca un marcador en el mapa para ver los detalles',
            'retailer.tip2': 'No todas las tiendas tienen todos los raspaditos',
            'retailer.tip3': 'Llama antes para confirmar la disponibilidad del boleto',
            'retailer.official': 'Localizador oficial de la Lotería de TX',
            'retailer.locating': 'Localizando…',
            'retailer.searchingRetailers': 'Buscando puntos de venta de la Lotería de Texas...',
            'retailer.searchingList': 'Buscando puntos de venta cercanos…',
            'retailer.gettingLocation': 'Obteniendo tu ubicación...',
            'retailer.notifNoZipCity': 'Ingresa un código postal o ciudad',
            'retailer.notFound': 'Ubicación no encontrada. Intenta otra búsqueda.',
            'retailer.searchError': 'Error al buscar puntos de venta: {msg}',
            'retailer.geoUnsupported': 'Tu navegador no admite geolocalización',
            'retailer.geoFailed': 'No se pudo obtener tu ubicación. Ingresa un código postal o ciudad.',
            'retailer.yourLocation': 'Tu ubicación',
            'retailer.searchLocation': 'Ubicación de búsqueda',
            'retailer.mapCenter': 'Centro del mapa',
            'retailer.defaultName': 'Punto de venta de lotería',
            'retailer.carries': 'Vendido aquí recientemente',
            'retailer.soldAsOf': 'Última venta aquí: {when}',
            'retailer.stockCaveat': 'Las tiendas informan qué juegos tienen; nadie publica inventario en vivo, así que una tienda listada puede estar agotada. Llama antes de un viaje largo.',
            'retailer.general': 'Lotería en general',
            'retailer.generalFull': 'Punto de venta de lotería en general',
            'retailer.noAddress': 'Dirección no disponible',
            'retailer.directions': 'Cómo llegar',
            'retailer.getDirections': 'Cómo llegar',
            'retailer.milesAway': 'a {d} millas',
            'retailer.milesApprox': 'a ~{d} millas',
            'retailer.placingPins': 'Lista lista — ubicando las tiendas en el mapa...',
            'retailer.zipClusterTitle': '{n} tiendas en el código postal {zip}',
            'retailer.zipClusterNote': 'Aproximado — ubicado en el centro del código postal. Los puntos exactos aparecen al confirmarse las direcciones.',
            'retailer.andMore': '+{n} más',
            'retailer.nRetailersNearby': '{n} puntos de venta cercanos',
            'retailer.showingNofTotal': 'mostrando los {n} más cercanos de {total}',
            'retailer.dataAsOf': 'Datos de tiendas del {when} ({age})',
            'retailer.nameNote': 'Los nombres son los registrados en la Lotería de Texas. El letrero de la tienda puede mostrar otra marca — muchas son gasolineras, así que una tienda listada con su nombre comercial puede ser el Valero o Shell que usted conoce.',
            'retailer.nConfirmed': '{n} confirmados con este juego',
            'retailer.noneInArea': 'No se encontraron puntos de venta en esta zona.',
            'retailer.tryDifferent': 'Prueba con otro código postal o ciudad.',
            'retailer.errCouldntLoad': 'No se pudieron cargar los puntos de venta: la Lotería de Texas devolvió un error ({msg})',
            'retailer.errNoneNear': 'No se encontraron puntos de venta cerca de {loc}.',
            'retailer.carriersOne': '1 punto de venta tiene "{game}" en ~{r} mi',
            'retailer.carriersMany': '{n} puntos de venta tienen "{game}" en ~{r} mi',
            'retailer.noCarrier': 'Ningún punto de venta en esta zona reporta tener "{game}". Mostrando {n} puntos de venta de lotería.',
            'retailer.foundN': 'Se encontraron {n} puntos de venta',
            'retailer.showingWithin': 'Mostrando {n} puntos de venta en un radio de {r} millas',
            'retailer.thisLocation': 'esta ubicación',

            'app.loadingData': 'Cargando datos de lotería...',
            'app.usingCached': 'Usando datos guardados; inicia el servidor para datos en vivo',
            'app.usingCachedAge': 'Sin conexión — mostrando datos de {age}. Inicia el servidor para datos en vivo.',
            'app.bundledSnapshot': 'la copia incluida en la app',
            'age.minutes': 'hace {n} min',
            'age.hours': 'hace {n} horas',
            'age.days': 'hace {n} días',
            'dash.unknownDate': 'desconocido — nunca actualizado',
            'dash.sourceLabel': 'Fuente: {src}',
            'dash.source.live': 'en vivo de la Lotería de Texas',
            'dash.source.cache': 'copia guardada (sin conexión)',
            'dash.source.bundled': 'copia incluida (nunca actualizada)',
            'dash.staleHint': 'más de un día; los premios restantes pueden haber cambiado',
            'app.refreshFailed': 'No se pudo actualizar; usando datos guardados',
            'app.gameDataUnavailable': 'Datos del juego no disponibles',
            'app.locationSet': 'Ubicación fijada: {loc}',

            'footer.line1': 'Esta aplicación es solo informativa. Juega con responsabilidad.',
            'footer.line2': 'Datos de la Lotería de Texas. Debes tener 18+ para jugar.',
            'footer.disclaimer': 'Las probabilidades mostradas son estimaciones. Las probabilidades reales pueden variar. Consulta siempre las fuentes oficiales.'
        }
    };

    const STORAGE_KEY = 'lotchance.lang';

    let saved = '';
    try { saved = localStorage.getItem(STORAGE_KEY) || ''; } catch (e) { /* ignore */ }
    const firstLaunch = !saved;
    let lang = saved;
    if (!translations[lang]) {
        lang = (navigator.language || '').toLowerCase().indexOf('es') === 0 ? 'es' : 'en';
    }

    function t(key, params) {
        const dict = translations[I18N.lang] || translations.en;
        let s = dict[key] != null ? dict[key] : (translations.en[key] != null ? translations.en[key] : key);
        if (params) {
            for (const k in params) {
                s = s.split('{' + k + '}').join(params[k]);
            }
        }
        return s;
    }

    function applyStatic() {
        document.querySelectorAll('[data-i18n]').forEach(function (el) {
            el.textContent = t(el.getAttribute('data-i18n'));
        });
        document.querySelectorAll('[data-i18n-placeholder]').forEach(function (el) {
            el.setAttribute('placeholder', t(el.getAttribute('data-i18n-placeholder')));
        });
        document.documentElement.lang = I18N.lang;
        const badge = document.getElementById('langCurrent');
        if (badge) badge.textContent = I18N.lang.toUpperCase();
    }

    function rerenderApp() {
        const app = window.app;
        if (!app || !app.games || app.games.length === 0) return;
        try {
            app.updateDashboard();
            app.updateTopPicks();
            app.generateInsights();
            app.applyFilters(); // re-renders the games grid
            app.updateLastRefreshTime();

            if (app.nearMeLocation) {
                const s = document.getElementById('nearMeStatus');
                if (s) s.textContent = app.nearMeLocation.lat.toFixed(4) + ', ' + app.nearMeLocation.lng.toFixed(4);
            }
        } catch (e) {
            console.warn('[i18n] re-render failed:', e);
        }
    }

    function setLanguage(newLang) {
        if (!translations[newLang]) return;
        I18N.lang = newLang;
        try { localStorage.setItem(STORAGE_KEY, newLang); } catch (e) { /* ignore */ }
        applyStatic();
        rerenderApp();
    }

    function showPicker() {
        if (document.getElementById('langPickerOverlay')) return;
        const ov = document.createElement('div');
        ov.id = 'langPickerOverlay';
        ov.className = 'lang-picker-overlay';
        ov.innerHTML =
            '<div class="lang-picker">' +
            '  <i class="fas fa-globe lang-picker-icon"></i>' +
            '  <h2>Choose your language<br><span>Elige tu idioma</span></h2>' +
            '  <div class="lang-picker-buttons">' +
            '    <button class="lang-btn" data-lang="en">English</button>' +
            '    <button class="lang-btn" data-lang="es">Español</button>' +
            '  </div>' +
            '</div>';
        ov.querySelectorAll('.lang-btn').forEach(function (btn) {
            btn.addEventListener('click', function () {
                setLanguage(btn.getAttribute('data-lang'));
                ov.remove();
            });
        });
        document.body.appendChild(ov);
    }

    const I18N = { lang: lang, t: t, setLanguage: setLanguage, applyStatic: applyStatic, showPicker: showPicker, firstLaunch: firstLaunch };
    window.I18N = I18N;
    window.t = t;

    document.addEventListener('DOMContentLoaded', function () {
        applyStatic();
        const switcher = document.getElementById('langSwitcher');
        if (switcher) switcher.addEventListener('click', showPicker);
        if (firstLaunch) showPicker();
    });
})();
