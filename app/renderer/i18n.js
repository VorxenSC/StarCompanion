// UI translations. The English text is the key: t('Where to buy') gives the Portuguese text when
// Portuguese is on, and anything missing falls back to English instead of breaking. {name} placeholders
// are filled from vars. Plain script: used by the renderer (window.CompanionI18n) and the main process.
(function (root) {
  const PT = {
    // Types and filters
    All: 'Tudo', Items: 'Itens', Ships: 'Naves', Blueprints: 'Blueprints', Missions: 'Missões', Minerals: 'Minérios', Commodities: 'Commodities', Locations: 'Locais',
    Item: 'Item', Ship: 'Nave', Blueprint: 'Blueprint', Mission: 'Missão', Mineral: 'Minério', Commodity: 'Commodity', Location: 'Local',
    'Filter · {name}': 'Filtro · {name}',
    // Search bar and footer
    'Search items, ships, blueprints, missions, minerals…': 'Buscar itens, naves, blueprints, missões, minérios…',
    'Search Star Companion': 'Buscar no Star Companion',
    hide: 'esconder', open: 'abrir', navigate: 'navegar', filter: 'filtrar',
    'Clear search': 'Limpar busca', Settings: 'Configurações', 'Drag to resize': 'Arraste para redimensionar',
    Suggest: 'Sugerir', 'Buy me a coffee': 'Me pague um café',
    'Send an idea, a bug or a data fix to the developer': 'Envie uma ideia, um bug ou uma correção de dados ao desenvolvedor',
    'Star Companion is free and built in my spare time. If it saved you a trip, a hunt or a few million aUEC, a coffee helps keep it updated every patch. Thank you, citizen — o7':
      'O Star Companion é gratuito e feito no meu tempo livre. Se ele te poupou uma viagem, uma caçada ou alguns milhões de aUEC, um café ajuda a mantê-lo atualizado a cada patch. Obrigado, cidadão — o7',
    'Loading database…': 'Carregando a base de dados…',
    '{records} records · data {date}': '{records} registros · dados de {date}',
    'Database updated — reloading…': 'Base atualizada — recarregando…',
    'Some sources failed to update; previous data kept.': 'Algumas fontes falharam; os dados anteriores foram mantidos.',
    'Could not load the database: {error}': 'Não foi possível carregar a base: {error}',
    'Nothing matches “{q}”': 'Nada encontrado para “{q}”', 'No signal': 'Sem sinal',
    'Back ': 'Voltar ',
    // PU version tag
    'Data PU {data} · PU {live} live': 'Dados PU {data} · PU {live} no ar',
    'The game is now on PU {live}; this data is for PU {data}. Tray menu → Update database.': 'O jogo agora está na PU {live}; estes dados são da PU {data}. Menu da bandeja → Atualizar base de dados.',
    'Data matches the live Star Citizen version (PU {live}, per UEX).': 'Os dados batem com a versão atual do Star Citizen (PU {live}, segundo a UEX).',
    'Data for Star Citizen PU {data}.': 'Dados do Star Citizen PU {data}.',
    // Detail: common
    Yes: 'Sim', Description: 'Descrição', Where: 'Onde', Price: 'Preço', 'Sells for': 'Vende por', Verified: 'Verificado', Source: 'Fonte',
    Manufacturer: 'Fabricante', Type: 'Tipo', Size: 'Tamanho', Grade: 'Grau', Class: 'Classe', 'Lowest price': 'Menor preço', 'Player market': 'Mercado de jogadores',
    Craftable: 'Craftável', Loot: 'Loot', 'Can be found as loot': 'Pode ser encontrado como loot', 'View the {name} blueprint →': 'Ver o blueprint de {name} →',
    'Where to buy': 'Onde comprar', 'Not sold in any known shop — found as loot.': 'Não é vendido em lojas conhecidas — vem de loot.', 'No known shop in the sources.': 'Nenhuma loja conhecida nas fontes.',
    'Player market (UEX)': 'Mercado de jogadores (UEX)', 'Approx. asking price': 'Preço pedido aprox.', Range: 'Faixa', Offers: 'Ofertas', Latest: 'Mais recente',
    '{n} selling': '{n} vendendo', '{n} buying': '{n} comprando', 'Not listed by players right now.': 'Nenhum jogador anunciando agora.',
    'Median of open player sell offers on the UEX marketplace; quality, pips and bundles vary, so check the listings.': 'Mediana das ofertas de venda abertas no marketplace da UEX; qualidade, pips e pacotes variam, então confira os anúncios.',
    'Open the UEX marketplace filtered for this item ↗': 'Abrir o marketplace da UEX filtrado para este item ↗', 'UEX market': 'Mercado UEX', 'RSI store': 'Loja RSI',
    // Ship
    Crew: 'Tripulação', Cargo: 'Carga', Speed: 'Velocidade', Hull: 'Casco', Shield: 'Escudo', 'Pilot DPS': 'DPS do piloto', 'Store price': 'Preço na loja', Warbond: 'Warbond',
    'In-game price': 'Preço no jogo', 'Last warbond': 'Último warbond', Status: 'Status', 'class {n}': 'classe {n}', 'SCM {scm} · max {max}': 'SCM {scm} · máx {max}', '${price} · ended': '${price} · encerrado',
    'Price in USD (RSI store)': 'Preço em dólar (loja RSI)', Offer: 'Oferta', Checked: 'Conferido', package: 'pacote', 'on sale': 'à venda', 'off sale': 'fora de venda',
    'Warbond: a discounted offer that must be paid with new money (not store credit).': 'Warbond: oferta com desconto que precisa ser paga com dinheiro novo (não com crédito da loja).',
    ' MSRP — not listed in the store right now.': ' MSRP — fora da loja no momento.', 'No USD price (not sold in the RSI store).': 'Sem preço em dólar (não vendida na loja RSI).',
    'Buy in game (aUEC)': 'Comprar no jogo (aUEC)', 'Not sold in any in-game shop.': 'Não é vendida em nenhuma loja do jogo.', 'Rent in game': 'Alugar no jogo',
    'Default components': 'Componentes padrão', Slot: 'Slot', Component: 'Componente',
    // Blueprint
    'Craft time': 'Tempo de craft', Materials: 'Materiais', 'Default blueprint': 'Blueprint padrão', 'None known': 'Nenhuma conhecida', 'Best drop': 'Melhor drop',
    Material: 'Material', Qty: 'Qtd', 'Quality affects': 'A qualidade afeta', ' or ': ' ou ', pcs: 'un', 'Missions that reward it': 'Missões que o dão', Chance: 'Chance',
    'Every player already owns this blueprint.': 'Todo jogador já tem este blueprint.', 'No known mission.': 'Nenhuma missão conhecida.', 'Where to buy a ready-made {name} →': 'Onde comprar {name} pronto →',
    // Mission
    Contractor: 'Contratante', Faction: 'Facção', Systems: 'Sistemas', Legality: 'Legalidade', Reward: 'Recompensa', 'Minimum reputation': 'Reputação mínima',
    Combat: 'Combate', 'Cargo hauling': 'Transporte de carga', Shareable: 'Compartilhável', 'One-time only': 'Só uma vez', 'Blueprints it can reward': 'Blueprints que pode dar',
    // Mineral
    'Found at': 'Encontrado em', 'Sell value': 'Valor de venda', 'Best sale at': 'Melhor venda em', 'Scan signature': 'Assinatura de scan', Instability: 'Instabilidade',
    Resistance: 'Resistência', 'Found with': 'Vem junto com', Trading: 'Comércio', 'Prices and demand per location for {name} →': 'Preços e demanda por local de {name} →',
    'Where to mine': 'Onde minerar', Abundance: 'Abundância', 'No known locations.': 'Nenhum local conhecido.', 'Used in {n} blueprints': 'Usado em {n} blueprints',
    // Commodity
    'Very high': 'Muito alta', High: 'Alta', Good: 'Boa', Medium: 'Média', Low: 'Baixa', 'Very low': 'Muito baixa', None: 'Nenhuma',
    'Out of stock': 'Esgotado', Full: 'Cheio', 'Very high stock': 'Muito alto', 'High stock': 'Alto', 'Low stock': 'Baixo', 'Very low stock': 'Muito baixo', 'Medium stock': 'Médio',
    'AUTO LOAD': 'AUTO CARGA', ELEVATOR: 'ELEVADOR', DOCK: 'DOCA',
    'Cargo is loaded and unloaded automatically': 'A carga é colocada e retirada automaticamente', 'Cargo is moved by hand': 'A carga é movida manualmente',
    'Best sale': 'Melhor venda', 'Cheapest buy': 'Compra mais barata', Code: 'Código', 'Sell at': 'Vende em', 'Buy at': 'Compra em', '{n} terminals': '{n} terminais',
    'Nowhere listed': 'Em nenhum lugar', 'Auto load/unload': 'Auto carga/descarga', '{n} of {total} locations': '{n} de {total} locais',
    'Illegal — scanned cargo is contraband': 'Ilegal — carga escaneada é contrabando', Mining: 'Mineração', 'Where to mine {name} →': 'Onde minerar {name} →',
    'Sell here · demand per location': 'Venda aqui · demanda por local', 'Pays / SCU': 'Paga / SCU', Demand: 'Demanda', Updated: 'Atualizado', 'No terminal buys it.': 'Nenhum terminal compra.',
    'Buy here · stock per location': 'Compre aqui · estoque por local', 'Costs / SCU': 'Custa / SCU', Stock: 'Estoque', 'No terminal sells it.': 'Nenhum terminal vende.',
    'Demand and stock are UEX inventory levels reported by players; they move as people trade. AUTO LOAD: cargo is loaded and unloaded for you; ELEVATOR / DOCK: you move it by hand.':
      'Demanda e estoque são níveis de inventário da UEX informados por jogadores; mudam conforme o pessoal negocia. AUTO CARGA: a carga é colocada e retirada para você; ELEVADOR / DOCA: você move na mão.',
    // Location
    Inside: 'Dentro de', System: 'Sistema', 'Missions available': 'Missões disponíveis',
    // Startup notice
    'Before you start': 'Antes de começar', 'Star Companion needs': 'O Star Companion precisa de',
    'Borderless window': 'Janela sem bordas', 'Run Star Citizen in Borderless mode (Graphics → Window Mode). No overlay can appear over exclusive Fullscreen.':
      'Rode o Star Citizen em modo Borderless (Gráficos → Modo de janela). Nenhum overlay aparece sobre a Tela cheia exclusiva.',
    '{key} to open': '{key} para abrir',
    'Press {key} or click the small icon to open and close the search. To use another key, click {key} in the search bar or open Settings.':
      'Aperte {key} ou clique no pequeno ícone para abrir e fechar a busca. Para usar outra tecla, clique em {key} na barra de busca ou abra as Configurações.',
    Internet: 'Internet', 'Search works offline. Item pictures, links, "Update database" and app updates need a connection.':
      'A busca funciona offline. Fotos de itens, links, "Atualizar base de dados" e as atualizações do app precisam de conexão.',
    'Community data': 'Dados da comunidade',
    'Prices, shops, locations and drop chances come from community sites (cstone, sc-craft.tools, scminer.rocks, starcitizen.tools, UEX) and can lag behind a new patch. Data for PU {pu}, collected {date}; the PU tag turns amber when a new patch is live. Check in game before a long trip.':
      'Preços, lojas, locais e chances de drop vêm de sites da comunidade (cstone, sc-craft.tools, scminer.rocks, starcitizen.tools, UEX) e podem atrasar em relação a um patch novo. Dados da PU {pu}, coletados em {date}; o selo da PU fica âmbar quando sai um patch novo. Confira no jogo antes de uma viagem longa.',
    Unofficial: 'Não oficial', 'A fan-made tool, not affiliated with Cloud Imperium Games or Roberts Space Industries.': 'Uma ferramenta feita por fã, sem ligação com a Cloud Imperium Games ou a Roberts Space Industries.',
    'Buy me a coffee ↗': 'Me pague um café ↗', 'Don’t show this again': 'Não mostrar de novo', 'Got it ': 'Entendi ',
    // Shortcut recorder
    'Keyboard shortcut': 'Atalho de teclado', 'Press the new shortcut': 'Aperte o novo atalho',
    'Press one key on its own (no Ctrl, Alt or Shift). It opens and closes Star Companion from anywhere, including in game. That key is reserved for Star Companion while it runs, so pick one you don’t type elsewhere; the numpad keys work well.':
      'Aperte uma tecla sozinha (sem Ctrl, Alt ou Shift). Ela abre e fecha o Star Companion de qualquer lugar, inclusive no jogo. Essa tecla fica reservada para o Star Companion enquanto ele roda, então escolha uma que você não digite em outros lugares; as teclas do teclado numérico funcionam bem.',
    'Waiting for a key…': 'Esperando uma tecla…', 'Current: ': 'Atual: ', 'Cancel ': 'Cancelar ', 'Save ': 'Salvar ',
    'Use a single key: Ctrl, Alt, Shift and Win can’t be the shortcut.': 'Use uma tecla só: Ctrl, Alt, Shift e Win não podem ser o atalho.',
    'Use a single key on its own, without Ctrl, Alt or Shift.': 'Use uma tecla sozinha, sem Ctrl, Alt ou Shift.',
    "{key} can't be used as a shortcut.": '{key} não pode ser usada como atalho.',
    '{key} is not available — another program may already use it. Try another.': '{key} não está disponível — outro programa pode já usá-la. Tente outra.',
    // Suggestions
    Suggestions: 'Sugestões', 'Help shape Star Companion': 'Ajude a moldar o Star Companion',
    'Ideas, bugs, wrong prices or missing items: it goes straight to the developer.': 'Ideias, bugs, preços errados ou itens faltando: vai direto para o desenvolvedor.',
    Idea: 'Ideia', Bug: 'Bug', 'Wrong or missing data': 'Dado errado ou faltando', Other: 'Outro', 'Kind of suggestion': 'Tipo de sugestão',
    'Your message': 'Sua mensagem', 'What would make Star Companion better? What broke, or what did you not find?': 'O que deixaria o Star Companion melhor? O que quebrou ou o que você não encontrou?',
    'Name or Discord · optional': 'Nome ou Discord · opcional', 'Email for a reply · optional': 'E-mail para resposta · opcional',
    'Include app version and PU {pu}': 'Incluir a versão do app e da PU {pu}', 'Send ': 'Enviar ', 'Sending…': 'Enviando…',
    'Please write at least a sentence.': 'Escreva pelo menos uma frase.', 'Thanks! Please wait a minute before sending another one.': 'Obrigado! Espere um minuto antes de enviar outra.',
    'Thank you, citizen — o7': 'Obrigado, cidadão — o7', 'Your message is on its way to the developer. Every idea is read.': 'Sua mensagem está a caminho do desenvolvedor. Toda ideia é lida.',
    'Back to search ': 'Voltar à busca ', 'Suggestions are not set up in this build yet.': 'As sugestões ainda não estão configuradas nesta versão.',
    'Could not send ({reason}). Your text is kept; try again.': 'Não foi possível enviar ({reason}). Seu texto foi mantido; tente de novo.',
    'timed out': 'tempo esgotado', 'no connection': 'sem conexão', 'The server answered {status}.': 'O servidor respondeu {status}.',
    // Settings
    'Done ': 'Pronto ', Opening: 'Abertura', Shortcut: 'Atalho', 'Opens and closes the search, even in game': 'Abre e fecha a busca, mesmo no jogo', Change: 'Trocar',
    'Start with Windows': 'Iniciar com o Windows', 'Launch quietly when you sign in': 'Abre discretamente quando você entra no Windows', 'Available in the installed app': 'Disponível no app instalado',
    'Close when clicking the game': 'Fechar ao clicar no jogo', 'Fold back into the icon when the game gets focus': 'Recolhe para o ícone quando o jogo ganha o foco',
    Look: 'Aparência', 'Show icon when closed': 'Mostrar ícone quando fechado', 'A faint icon stays on screen; click it to open': 'Um ícone discreto fica na tela; clique nele para abrir',
    'Icon opacity': 'Opacidade do ícone', 'How visible the icon is while you play': 'O quanto o ícone aparece enquanto você joga', 'Window opacity': 'Opacidade da janela',
    'Text size': 'Tamanho do texto', 'Also Ctrl + = and Ctrl + -': 'Também Ctrl + = e Ctrl + -', 'Position and size': 'Posição e tamanho',
    'Back to the default place and size': 'Volta ao lugar e tamanho padrão', Reset: 'Restaurar', Language: 'Idioma', 'Automatic follows Windows': 'Automático segue o Windows',
    Automatic: 'Automático', 'Updates and help': 'Atualizações e ajuda', 'Check for updates at launch': 'Procurar atualizações ao abrir', 'You have v{version}': 'Você tem a v{version}',
    'Check now': 'Procurar agora', 'Startup notice': 'Aviso inicial', 'What the overlay needs to work': 'O que o overlay precisa para funcionar', Show: 'Mostrar',
    'Settings file': 'Arquivo de configurações', 'For advanced edits; opens its folder': 'Para edições avançadas; abre a pasta dele', 'Show in folder': 'Mostrar na pasta',
    'About Star Companion': 'Sobre o Star Companion',
    "I built Star Companion for players whose PCs struggle to leave Star Citizen: on many machines, a quick Alt+Tab to check a price turns into a long freeze, stutters or even a crash. Here, everything you'd look up sits right on top of the game: press a key, find it, keep flying. And even on a powerful rig, it's simply faster than leaving the cockpit.":
      'Criei o Star Companion para quem joga num PC que sofre para sair do Star Citizen: em muitas máquinas, um simples Alt+Tab para conferir um preço vira um travamento longo, engasgos ou até um crash. Aqui, tudo o que você procuraria fica por cima do jogo: aperte uma tecla, encontre, continue voando. E mesmo num PC potente, é simplesmente mais rápido do que sair do cockpit.',
    // Tray menu and dialogs (main process)
    'Show / hide ({key})': 'Mostrar / esconder ({key})', 'Settings…': 'Configurações…', 'Check for updates (v{version})': 'Procurar atualizações (v{version})',
    'Updating database…': 'Atualizando a base de dados…', 'Update database': 'Atualizar base de dados', 'Send a suggestion…': 'Enviar uma sugestão…',
    'Buy me a coffee…': 'Me pague um café…', Quit: 'Sair', 'Star Companion — press {key} to open': 'Star Companion — aperte {key} para abrir',
    'Downloading update… {pct}%': 'Baixando atualização… {pct}%', 'Downloading update…': 'Baixando atualização…',
    'Star Companion update': 'Atualização do Star Companion', 'Star Companion {version} is available': 'O Star Companion {version} está disponível',
    "You have {current}. The portable version can't update itself: download the new one from GitHub.": 'Você tem a {current}. A versão portátil não se atualiza sozinha: baixe a nova no GitHub.',
    'You have {current}. Update now? It downloads (about 100 MB), installs and restarts Star Companion.': 'Você tem a {current}. Atualizar agora? Ele baixa (cerca de 100 MB), instala e reinicia o Star Companion.',
    'Open download page': 'Abrir a página de download', 'Update now': 'Atualizar agora', Later: 'Depois', "Don't remind me about this version": 'Não lembrar desta versão',
    'You have the latest version.': 'Você tem a versão mais recente.', 'Could not check for updates.': 'Não foi possível procurar atualizações.',
    'Updates are checked by the installed app.': 'As atualizações são verificadas pelo app instalado.', 'You are running from source; use git pull.': 'Você está rodando pelo código-fonte; use git pull.',
  };

  const STRINGS = { 'pt-BR': PT };
  let lang = 'en';

  function t(key, vars) {
    const s = (STRINGS[lang] && STRINGS[lang][key]) || key;
    return vars ? s.replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? String(vars[k]) : m)) : s;
  }

  // 'auto' follows the system's languages: Portuguese of any region → pt-BR, everything else → English.
  function resolve(setting, systemLanguages) {
    if (setting === 'en' || setting === 'pt-BR') return setting;
    return (systemLanguages || []).some((l) => /^pt\b/i.test(l)) ? 'pt-BR' : 'en';
  }

  const api = { t, resolve, setLanguage: (l) => { lang = STRINGS[l] ? l : 'en'; }, getLanguage: () => lang, languages: ['auto', 'en', 'pt-BR'] };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CompanionI18n = api;
})(typeof window !== 'undefined' ? window : globalThis);
