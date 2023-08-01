const fs = require('fs');

if (process.argv.length <= 3) {
    console.log("Error: XML file not specified.");
    console.log("usage: node transformToJson.js <path/to/mule-xml.xml> <output.json>");
    process.exit(1);
}

const inputfile = process.argv[2];
const outputfile = process.argv[3];

const text = fs.readFileSync(inputfile, 'utf-8');
// console.log(text);

var DOMParser = require('xmldom').DOMParser;
const parser = new DOMParser();
let dom  = parser.parseFromString(text, "text/xml");

// console.log(xmlData);
// 先頭のmuleノードに移動する
const muleNode = dom.documentElement;

console.log("- muleNode= " + muleNode.tagName);

// for(var node in muleNode.childNodes) {
//     console.log(JSON.stringify(node));
// }
const slices = inputfile.split("\\");
var muleData = {name: slices[slices.length - 1]};
muleData.flows = parseFirstLevelNodes(muleNode.childNodes);

// console.log("-------- MuleData");
// console.log(JSON.stringify(muleData));
fs.writeFileSync(outputfile, JSON.stringify(muleData), 'utf-8');

// muleタグ内の flow, sub-flow などを抽出
function parseFirstLevelNodes(nodes) {
    var flows = [];

    for(var i=0; i < nodes.length; i++) {
        const node = nodes[i];
        if (node.tagName == undefined) {
            continue;
        }
        console.log("- node = " + node.tagName);

        switch(node.tagName) {
            case "http:listener-config":
                console.log("http:listener-config skipped");
                break;
            case "flow":
                // flow のパース処理
                var flow = {name: node.getAttribute("name"), type:"flow"};
                flow.components = parseInnerFlowNodes(node.childNodes);
                flows.push(flow);
                break;
            case "sub-flow":
                // sub-flow のパース処理
                var subflow = {name: node.getAttribute("name"), type:"sub-flow"};
                subflow.components = parseInnerFlowNodes(node.childNodes);
                flows.push(subflow);
                break;
        }
    }
    return flows;
}


// flow, sub-flow タグの中身である各種コンポーネント情報を拾う
function parseInnerFlowNodes(nodes) {
    let components = [];

    for(var i=0; i < nodes.length; i++) {
        const node = nodes[i];

        if(node.tagName == undefined) {
            continue;
        }
        console.log("- node = " + node.tagName);

        // 複数層にならないコンポーネントかどうかを先に判断する
        if( ! isLayerFreeComponentProcess(node, components) ) {
            // 複数層に跨り得るコンポーネントはそれぞれチェック
            switch(node.tagName) {
                case "try":
                    // try のパース処理 ()
                    var cmp = {name: node.getAttribute("doc:name"), type:"try",
                                docid: node.getAttribute("doc:id")};
                    cmp.children = parseInnerTryNode(node.childNodes);
                    components.push(cmp);
                    break;
                case "choice":
                    // choice のパース処理
                    var cmp = {name: node.getAttribute("doc:name"), type:"choice_",
                                docid: node.getAttribute("doc:id")};
                    cmp.children = parseInnerChoiceNode(node.childNodes);
                    components.push(cmp);
                    break;
                case "ee:transform":
                    // ee:transform のパース処理
                    var cmp = {name: node.getAttribute("doc:name"), type:"transform",
                                    docid: node.getAttribute("doc:id")};
                    cmp.children = parseInnerTransformNode(node.childNodes);
                    components.push(cmp);
                    break;
                case "error-handler":
                    // http:request のパース処理
                    var cmp = {name: "error-handler", type:"error-handler",
                                    docid: node.getAttribute("doc:id")};
                    cmp.children = parseInnerErrorHandlerNode(node.childNodes);
                    components.push(cmp);
                    break;
            }
        }
    
    }

    return components;
}


function isLayerFreeComponentProcess(node, components) {
    let isFree = false;

    switch(node.tagName) {
        case "logger":
            // logger のパース処理 
            var cmp = {name: node.getAttribute("doc:name"), type:"logger", 
                        docid: node.getAttribute("doc:id"), message: node.getAttribute("message")};
            cmp.children = [];
            components.push(cmp);
            isFree=true;
            break;
        case "flow-ref":
            // flow-ref のパース処理 
            var cmp = {name: node.getAttribute("doc:name"), type:"flow-ref", 
                        docid: node.getAttribute("doc:id"), refFlowName: node.getAttribute("name")};
            cmp.children = [];
            components.push(cmp);
            isFree=true;
            break;
        case "raise-error":
            // raise-error のパース処理 
            var cmp = {name: node.getAttribute("doc:name"), type:"raise-error", 
                        docid: node.getAttribute("doc:id"), errorType: node.getAttribute("type"), 
                        description: node.getAttribute("description")};
            cmp.children = [];
            components.push(cmp);
            isFree=true;
            break;
        case "set-variable":
            // set-variable のパース処理
            var cmp = {name: node.getAttribute("doc:name"), type:"set-variable",
                        docid: node.getAttribute("doc:id"), value: node.getAttribute("value"),
                        variableName: node.getAttribute("variableName")};
            cmp.children = [];
            components.push(cmp);
            isFree=true;
            break;
        case "http:request":
            // http:request のパース処理
            var cmp = {name: node.getAttribute("doc:name"), type:"http_request",
                            docid: node.getAttribute("doc:id")};
            cmp.children = [];
            components.push(cmp);
            break;
    }
    return isFree;
}

// <try>の内部ノードをパースする
function parseInnerTryNode(nodes) {
    return parseInnerFlowNodes(nodes);
}

// <choice>タグの内部ノードをパースする
function parseInnerChoiceNode(nodes) {
    let components = [];

    for(var i=0; i < nodes.length; i++) {
        const node = nodes[i];

        if(node.tagName == undefined) {
            continue;
        }

        console.log("- node = " + node.tagName);

        // 複数層にならないコンポーネントかどうかを先に判断する
        if( ! isLayerFreeComponentProcess(node, components) ) {
            switch(node.tagName) {
                case "when":
                    // when のパース処理 ()
                    var cmp = {name: getNameFromExpr(node.getAttribute("expression")), type:"when",
                                docid: node.getAttribute("doc:id"), expression: node.getAttribute("expression")};
                    cmp.children = parseInnerChoiceNode(node.childNodes);
                    components.push(cmp);
                    break;
                case "otherwise":
                    // otherwise のパース処理 ()
                    var cmp = {name: "otherwise", type:"otherwise",
                                docid: node.getAttribute("doc:id")};
                    cmp.children = parseInnerChoiceNode(node.childNodes);
                    components.push(cmp);
                    break;
                case "choice":
                    // choice のパース処理
                    var cmp = {name: node.getAttribute("doc:name"), type:"choice_",
                                docid: node.getAttribute("doc:id")};
                    cmp.children = parseInnerChoiceNode(node.childNodes);
                    components.push(cmp);
                    break;
                case "ee:transform":
                    // ee:transform のパース処理
                    var cmp = {name: node.getAttribute("doc:name"), type:"transform",
                                    docid: node.getAttribute("doc:id")};
                    cmp.children = parseInnerTransformNode(node.childNodes);
                    components.push(cmp);
                    break;
            }
        }
    }

    return components;
}

//
function parseInnerTransformNode(nodes) {
    let components = [];

    for(var i=0; i < nodes.length; i++) {
        const node = nodes[i];

        if(node.tagName == undefined) {
            continue;
        }

        console.log("- node = " + node.tagName);

        switch(node.tagName) {
            case "ee:message":
                // ee:message のパース処理 ()
                var cmp = {name: "message", type:"message",
                            docid: "" };
                cmp.children = parseInnerMessageNode(node.childNodes);
                components.push(cmp);
                break;
            case "ee:variables":
                // ee:variables のパース処理 ()
                var cmp = {name: "variables", type:"variables",
                            docid: "" };
                cmp.children = parseInnerVariablesNode(node.childNodes);
                components.push(cmp);
                break;
        }
    }

    return components;
}


function parseInnerMessageNode(nodes) {
    let components = [];

    for(var i=0; i < nodes.length; i++) {
        const node = nodes[i];

        if(node.tagName == undefined) {
            continue;
        }

        console.log("- node = " + node.tagName);

        switch(node.tagName) {
            case "ee:set-payload":
                // ee:set-payload のパース処理 ()
                var cmp = {name: "set-payload", type:"ee_set-payload",
                            docid: node.getAttribute("doc:id"), dwtext: node.textContent };
                cmp.children = [];
                components.push(cmp);
                break;
        }

    }

    return components;
}


function parseInnerVariablesNode(nodes) {
    let components = [];

    for(var i=0; i < nodes.length; i++) {
        const node = nodes[i];

        if(node.tagName == undefined) {
            continue;
        }

        console.log("- node = " + node.tagName);

        switch(node.tagName) {
            case "ee:set-variable":
                // ee:set-variable のパース処理 ()
                var cmp = {name: node.getAttribute("variableName"), type:"ee_set-variable", docid: "",
                            variableName: node.getAttribute("variableName"), dwtext: node.textContent };
                cmp.children = [];
                components.push(cmp);
                break;
        }
    }

    return components;
}


function parseInnerErrorHandlerNode(nodes) {
    let components = [];

    for(var i=0; i < nodes.length; i++) {
        const node = nodes[i];

        if(node.tagName == undefined) {
            continue;
        }

        console.log("- node = " + node.tagName);

        switch(node.tagName) {
            case "on-error-propagate":
                // when のパース処理 ()
                var cmp = {name: node.getAttribute("doc:name"), type:"on-error-propagate",
                            docid: node.getAttribute("doc:id"), enableNotifications: node.getAttribute("enableNotifications"),
                            logException: node.getAttribute("logException")};
                cmp.children = parseInnerFlowNodes(node.childNodes);
                components.push(cmp);
                break;
        }
    }

    return components;
}

// when専用： expression から名前となる文字列を取得
function getNameFromExpr(str) {
    // パラメータの文字列を"\n"で分割して１行目の文字列を取得する
    var lines = str.split("\n");
    if( lines[0].length > 50 ) {
        // 50文字目までの後ろに ".." を付けた文字列を返却
        return lines[0].substring(0, 50) + "..";
    } else {
        // 50文字以下ならそのまま1行目の文字列を返却
        return lines[0];
    }
}
