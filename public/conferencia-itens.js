(function(global){
  "use strict";
  const Fontes=typeof module!=="undefined"&&module.exports?require("./conferencia-fontes.js"):global.GemodFontesSES;
  const acao=/\b(?:apresentar|comprovar|justificar|ressarcir|restituir|encaminhar|regularizar|esclarecer|demonstrar|discriminar|informar|providenciar|corrigir|anexar|solicita(?:mos|-se)?|dever[aá]|necess[aá]rio)\b/iu;
  function detectar(paginas){
    let texto="";const mapa=[];
    for(const p of paginas){const inicio=texto.length;texto+=String(p.texto||"")+"\n";mapa.push({inicio,fim:texto.length-1,local:p.local});}
    const marcadores=[...texto.matchAll(/(?:^|\n)[ \t]*(\d{1,2}(?:\.\d{1,3}){0,5})(?![\d.])(?:[.)])?(?:[ \t]+|\r?\n)/g)];
    return marcadores.flatMap((m,i)=>{
      const numero=m[1],inicio=m.index+m[0].indexOf(numero),fim=marcadores[i+1]?.index??texto.length;
      // Parent paragraphs introduce their children; they are not another demand.
      if(!numero.includes(".")||marcadores[i+1]?.[1].startsWith(numero+"."))return[];
      const corpo=texto.slice(inicio,fim).trimEnd();if(!acao.test(corpo))return[];
      const partes=mapa.filter(p=>p.fim>inicio&&p.inicio<fim).map(p=>({local:p.local,texto:texto.slice(Math.max(inicio,p.inicio),Math.min(fim,p.fim)).trim()})).filter(p=>p.texto);
      const primeira=partes[0]?.local||"Página não identificada",ultima=partes.at(-1)?.local||primeira;
      return [{numero,titulo:corpo.replace(/\s+/g," ").split(":")[0].slice(0,240),paginas:partes,local:primeira===ultima?primeira:primeira+" a "+ultima}];
    });
  }
  function original(item,nome){
    const texto=item.paginas.map(p=>p.texto).join("\n"),pedido=acao.exec(texto);
    return {item:item.numero,extracao:"texto_original",tipo:"solicitacao",origem:nome,descricao:texto.slice(0,4000),
      providencia:(pedido?texto.slice(pedido.index):texto).slice(0,4000),referencia:item.titulo,
      trecho:item.paginas[0].texto.slice(0,1000),contextoSES:item.paginas.map(p=>p.local+"\n"+p.texto).join("\n\n").slice(0,12000),
      contextoMetodo:"item_numerado",contextoParcial:texto.length>12000,fonteVerificada:true,paginaConfirmada:true,local:item.local,
      termosBusca:[],consultasAlternativas:[],selecionado:true};
  }
  function individualizar(itens,paginas,nome){
    const numerados=detectar(paginas);if(!numerados.length||!Fontes)return {itens};
    const usados=new Set(),originais=[];
    const contem=(item,i)=>i.fonteVerificada&&Fontes.verificarFonte(item.paginas,i.trecho,i.local).fonteVerificada;
    const separados=numerados.slice(0,60).map(item=>{
      const base=original(item,nome),candidatos=itens.filter(i=>!usados.has(i)&&contem(item,i));
      const achado=candidatos.find(i=>i.item===item.numero)||candidatos.find(i=>!i.item&&numerados.filter(n=>contem(n,i)).length===1);
      if(!achado){originais.push(item.numero);return base;}
      usados.add(achado);
      if(achado.extracao==="texto_original"){originais.push(item.numero);return base;}
      const ref=String(achado.referencia||"");
      return {...achado,item:item.numero,referencia:(ref.startsWith(base.referencia)?ref:base.referencia+" · "+ref).slice(0,1500),
        contextoSES:base.contextoSES,contextoMetodo:base.contextoMetodo,contextoParcial:base.contextoParcial,local:base.local};
    });
    const outros=itens.filter(i=>!usados.has(i)).map(i=>({...i,item:"",extracao:"sem_item",selecionado:false}));
    return {itens:[...separados,...outros].map((i,j)=>({...i,id:"p"+(j+1)})),itensOriginais:originais,
      itensDetectados:numerados.map(i=>i.numero),leituraParcial:numerados.length>60};
  }
  const api={detectar,original,individualizar};if(typeof module!=="undefined"&&module.exports)module.exports=api;else global.GemodItensSES=api;
})(typeof window==="undefined"?globalThis:window);
