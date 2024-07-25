const NODE_ID_PREFIX = {PERSON: "p", UNION: "u"};
const TRANSITION = {DEFAULT_DURATION: 750, EXIT_OPACITY: 0};
const AVATAR_API_BASE = "https://api.dicebear.com/9.x/initials/svg";
const AVATAR_CACHE = new Map();
const MAX_CACHE_SIZE = 100;

function removeFromArray(array, ...values) {
    const removeSet = new Set(values);

    return array.filter(item => !removeSet.has(item));
}


function d3_append_multiline_text(d3element, text, delimiter = "_", css_class = undefined, lineSep = "1.2em",
                                  x = 13, dominant_baseline = "central") {
    // adds a multi-line text label to a d3 element
    if (!text) return;

    const lines = text.split(delimiter);
    // Use a more precise centering calculation
    const totalOffset = (lines.length - 1) / 2;

    const d3text = d3element.append("text")
        .attr("dominant-baseline", dominant_baseline)
        .attr("x", x)
        .attr("class", css_class || "");

    d3text.selectAll("tspan")
        .data(lines)
        .join("tspan")
        .attr("x", x)
        .attr("dy", (d, i) => i === 0 ? `-${totalOffset}em` : lineSep)
        .text(d => d);
}


class FTDataHandler {

    // Map for performance improvement
    nodeMap = new Map();

    constructor(data, start_node_id = data.start) {
        this.data = data;
        this.nodeMap = new Map();

        if (data.links?.length > 0) {
            this.dag = d3.dagConnect()(data.links);

            // Using a helper to clean up ID assignment
            if (this.dag.id !== undefined) {
                const newRoot = d3.dagNode(undefined, {});
                newRoot.children = [this.dag];
                this.dag = newRoot;
            }

            // get all d3-dag nodes and convert to family tree nodes
            this.nodes = this.dag.descendants().map(node => {
                let ftnode;
                if (data.unions?.[node.id]) ftnode = new Union(node, this, data);
                else if (data.persons?.[node.id]) ftnode = new Person(node, this, data);

                // caching for improving performance both unions and persons here
                if (ftnode) this.nodeMap.set(node.id, ftnode);
                return ftnode;
            });

            // relink children arrays: use family tree nodes instead of d3-dag nodes

            this.number_nodes = 0;
            this.nodes.forEach(n => {
                n._children = n._children
                    .map(c => c.ftnode)
                    .filter(Boolean); // drop unresolved references
                n.id = n.id ?? this.number_nodes;
                this.number_nodes++;
            });

            // set root node
            this.root = this.find_node_by_id(start_node_id);
            this.root.visible = true;
            this.dag.children = [this.root];

        }
        // if no edges but only nodes are defined: root = dag
        else if (Object.values(data.persons).length > 0) {

            const root_data = data.persons[start_node_id];
            this.root = new d3.dagNode(start_node_id, root_data);
            this.root = new Person(this.root, this, data);
            this.root.visible = true;

            this.nodeMap.set(start_node_id, this.root);

            this.number_nodes = 1;
            this.nodes = [this.root];

            // dag must be a node with id undefined
            this.dag = new d3.dagNode(undefined, {});
            this.dag.children = [this.root];
        }
    }

    update_roots() {
        this.dag.children = [this.root];
        const FT = this;

        function find_roots_recursive(node) {
            node.get_visible_inserted_neighbors().forEach(node => {
                if (node.is_root()) FT.dag.children.push(node);
                find_roots_recursive(node);
            });
        }

        find_roots_recursive(this.root);
    }

    find_node_by_id(id) {
        // retrieving from cache
        return this.nodeMap.get(id);
    }

}

function filterVisible(nodes, visible = true) {
    return nodes.filter(n => n.visible === visible);
}

class FTNode extends d3.dagNode {

    _isInserted(node) {
        return this.inserted_nodes.includes(node);
    }

    is_extendable() {
        return this.get_neighbors()?.some(node => !node.visible) ?? false;
    }

    is_female() {
        return false;
    }

    is_divorced() {
        return false;
    }

    get_visible_neighbors() {
        return this.get_neighbors()?.filter(node => node.visible) ?? [];
    }

    get_visible_inserted_neighbors() {
        return this.get_visible_neighbors().filter(node => this.inserted_nodes.includes(node));
    }

    union_label(union_label_func) {
        // setter for node labels
        if (union_label_func) {
            this.union_label_func = union_label_func
        }
        return this;
    }

}

class Union extends FTNode {

    constructor(dagNode, ft_datahandler, data) {
        super(dagNode.id, data.unions[dagNode.id]);
        // link to new object
        dagNode.ftnode = this;
        // define additional family tree properties
        this.ft_datahandler = ft_datahandler;
        this._children = dagNode.children;
        this.children = [];
        this._childLinkData = dagNode._childLinkData;
        this.inserted_nodes = [];
        this.inserted_links = [];
        this.visible = false;
        this.union_label(Union.default_union_label_func);
    }

    static default_union_label_func(link) {
        // node label function
        // text will be split into multiple lines where `label_delimiter` is used
        /*if (node.is_union()) {

        var displayLabel = (node.get_birth_year() || "?") + " - " + (node.get_death_year() || "?");
        if (node.get_birth_year() && node.get_death_year()) {
            displayLabel = (node.get_birth_year()) + " - " + (node.get_death_year()) + " (" + (node.get_death_year()-node.get_birth_year()) +" years)";
        }

        return node.get_name() +
            FTDrawer.label_delimiter +
            displayLabel;

        }*/
    };

    get_neighbors() {
        return this.get_parents().concat(this.get_children())
    }

    get_parents() {
        return (this.data.partner ?? []).flatMap(id => {
            const node = this.ft_datahandler.find_node_by_id(id);
            return node ? [node] : [];
        });
    }

    get_hidden_parents() {
        return filterVisible(this.get_parents(), false);
    }

    get_visible_parents() {
        return filterVisible(this.get_parents());
    }

    get_children() {
        const seen = new Set();
        return [...this.children, ...this._children]
            .filter(c => {
                if (!c || c.id === null || seen.has(c.id)) return false;
                seen.add(c.id);
                return true;
            });
    }

    get_hidden_children() {
        return filterVisible(this.get_children(), false);
    }

    get_visible_children() {
        return filterVisible(this.get_children());
    }

    show_child(child) {
        if (!this._children.includes(child)) {
            console.warn("Child node not in this' _children array.");
        }
        this.children.push(child);
        this._children = removeFromArray(this._children, child);
        // if child is already visible, note a connection to destroy it later
        if (child.visible) {
            this.inserted_links.push([this, child]);
        }
        // if child is hidden, show it
        else {
            child.visible = true;
            if (!this.inserted_nodes.includes(child)) {
                this.inserted_nodes.push(child);
            }
            // downstream part of the family tree is automatically reconstructed because children attribute
            // is not reset when hiding
        }
    }

    show_parent(parent) {
        if (!parent._children.includes(this)) {
            console.warn("This node not in parent's _children array.");
        }
        parent.children.push(this);
        parent._children = removeFromArray(parent._children, this);
        // if parent is already visible, note a connection to destroy it later
        if (parent.visible) {
            this.inserted_links.push([parent, this]);
        }
        // if parent is hidden, show it
        else {
            parent.visible = true;
            this.inserted_nodes.push(parent);
        }
    }

    show() {
        this.visible = true;

        // show neighboring children
        this.get_children().forEach(child => {
            this.show_child(child);
        })

        // show neighboring parents
        this.get_parents().forEach(parent => {
            this.show_parent(parent);
        })
    }

    get_visible_inserted_children() {
        return this.children.filter(c => this._isInserted(c));
    }

    get_visible_inserted_parents() {
        return this.get_visible_parents().filter(p => this._isInserted(p));
    }

    is_root() {
        return false;
    }

    hide_child(child) {
        if (!this.children.includes(child)) {
            console.warn("Child node not in this's children array.");
        }
        child.visible = false;
        this._children.push(child);
        this.children = removeFromArray(this.children, child);
        this.inserted_nodes = removeFromArray(this.inserted_nodes, child);
    }

    hide_parent(parent) {
        if (!parent.children.includes(this)) {
            console.warn("This node not in parent's children array.");
        }
        parent.visible = false;
        parent._children.push(this);
        parent.children = removeFromArray(parent.children, this);
        this.inserted_nodes = removeFromArray(this.inserted_nodes, parent);
    }

    hide() {
        this.visible = false;

        // hide neighboring children, if inserted by this node
        this.get_visible_inserted_children().forEach(child => {
            this.hide_child(child);
        })

        // hide neighboring parents, if inserted by this node
        this.get_visible_inserted_parents().forEach(parent => {
            this.hide_parent(parent);
        })

        // hide only edge (not node) if not inserted by this node
        this.inserted_links.forEach(edge => {
            const source = edge[0];
            const target = edge[1];
            if (this === source) {
                this._children.push(target);
                this.children = removeFromArray(this.children, target);
            } else if (this === target) {
                source._children.push(this);
                source.children = removeFromArray(source.children, this);
            }
        })
        this.inserted_links = [];
    }

    get_own_unions() {
        return [];
    }

    get_parent_unions() {
        return [];
    }

    get_name() {
        return undefined;
    }

    get_birth_year() {
        return undefined;
    }

    get_birth_place() {
        return undefined;
    }

    get_death_year() {
        return undefined;
    }

    get_summary() {
        return undefined;
    }

    get_death_place() {
        return undefined;
    }

    is_union() {
        return true;
    }

    add_parent(person_data) {
        // make person object
        const id = person_data.id || NODE_ID_PREFIX.PERSON + ++this.ft_datahandler.number_nodes;
        const dagNode = new d3.dagNode(id, person_data);
        const person = new Person(dagNode, this.ft_datahandler, this.ft_datahandler.data);
        if (!("parent_union" in person_data)) person_data.parent_union = undefined;
        if (!("own_unions" in person_data)) {
            person_data.own_unions = [this.id];
            person._childLinkData = [
                [person.id, this.id]
            ];
            person._children.push(this);
        }
        person.data = person_data;
        this.ft_datahandler.nodes.push(person);
        // make sure person lists this union as an own union
        if (!person_data.own_unions.includes(this.id)) person_data.own_unions.push(this.id);
        // make sure this union lists person as parent
        if (!this.data.partner.includes(person.id)) this.data.partner.push(person.id);
        // make union visible
        this.show_parent(person);
        this.ft_datahandler.update_roots();
        return person;
    }

    add_child(person_data) {
        // make person object
        const id = person_data.id || NODE_ID_PREFIX.PERSON + ++this.ft_datahandler.number_nodes;
        const dagNode = new d3.dagNode(id, person_data);
        const person = new Person(dagNode, this.ft_datahandler, this.ft_datahandler.data);

        if (person_data.parent_union !== this.id) {
            person_data.parent_union = this.id;
        }

        person_data.own_unions ??= [];

        person.data = person_data;
        this.ft_datahandler.nodes.push(person);

        // make sure this union lists person as child
        if (!this.data.children.includes(person.id)) this.data.children.push(person.id);
        if (!this._childLinkData.includes([this.id, person.id])) this._childLinkData.push([this.id, person.id]);
        // make union visible
        this.show_child(person);
        return person;
    }

}

class Person extends FTNode {

    constructor(dagNode, ft_datahandler, data) {
        super(dagNode.id, data.persons[dagNode.id]);
        // link to new object
        dagNode.ftnode = this;
        // define additional family tree properties
        this.ft_datahandler = ft_datahandler;
        this._children = dagNode.children;
        this.children = [];
        this._childLinkData = dagNode._childLinkData;
        this.inserted_nodes = [];
        this.inserted_links = [];
        this.visible = false;
    }

    get_name() {
        return this.data.name;
    }

    get_birth_year() {
        return this.data.birthyear;
    }

    get_birth_place() {
        return this.data.birthplace;
    }

    get_death_year() {
        return this.data.deathyear;
    }

    get_summary() {
        return this.data.summary;
    }

    get_death_place() {
        return this.data.deathplace;
    }

    get_neighbors() {
        return this.get_own_unions().concat(this.get_parent_unions());
    }

    is_female() {
        return this.data?.gender === 'female';
    }

    is_divorced() {
        return this.data?.divorced === 'true';
    }

    get_parent_unions() {
        let unions = [this.data.parent_union]
            .map(id => this.ft_datahandler.find_node_by_id(id))
            .filter(node => node != undefined);
        return unions;
    }

    get_hidden_parent_unions() {
        return filterVisible(this.get_parent_unions(), false);
    }

    get_visible_parent_unions() {
        return filterVisible(this.get_parent_unions());
    }

    get_visible_inserted_parent_unions() {
        return this.get_visible_parent_unions().filter(u => this._isInserted(u));
    }

    is_root() {
        return this.get_visible_parent_unions().length === 0;
    }

    is_union() {
        return false;
    }

    get_own_unions() {
        let unions = (this.data.own_unions ?? [])
            .map(id => this.ft_datahandler.find_node_by_id(id))
            .filter(u => u != undefined);
        return unions;
    }

    get_hidden_own_unions() {
        return filterVisible(this.get_own_unions(), false);
    }

    get_visible_own_unions() {
        return filterVisible(this.get_own_unions());
    }

    get_visible_inserted_own_unions() {
        return this.get_visible_own_unions().filter(u => this._isInserted(u));
    }

    get_parents() {
        let parents = [];
        this.get_parent_unions().forEach(
            u => parents = parents.concat(u.get_parents())
        )
        return parents;
    }

    get_other_partner(union_data) {
        let partner_id = union_data.partner.find(
            p_id => p_id !== this.id && p_id !== undefined
        )
        return this.ft_datahandler.find_node_by_id(partner_id);
    }

    get_spouses() {
        const spouses = [];

        this.get_own_unions().forEach(union => {
            union.get_parents().forEach(parent => {

                if (parent.id !== this.id) {
                    spouses.push(parent);
                }
            });
        });

        return [...new Set(spouses)];
    }

    get_children() {
        let children = [];
        this.get_own_unions().forEach(
            u => children = children.concat(u.get_children())
        )
        // sort children by birth year, filter undefined
        children = children
            .filter(c => c != undefined)
        // .sort((a, b) => Math.sign((getBirthYear(a) || 0) - (getBirthYear(b) || 0)));
        return children
    }

    show_union(union) {
        union.show();
        this.inserted_nodes.push(union);
    }

    hide_own_union(union) {
        union.hide();
        this.inserted_nodes = removeFromArray(this.inserted_nodes, union);
    }

    hide_parent_union(union) {
        union.hide();
    }

    show() {
        this.get_hidden_own_unions().forEach(union => this.show_union(union));
        this.get_hidden_parent_unions().forEach(union => this.show_union(union));
    }

    hide() {
        this.get_visible_inserted_own_unions().forEach(union => this.hide_own_union(union));
        this.get_visible_inserted_parent_unions().forEach(union => this.hide_parent_union(union));
    }

    click() {
        // extend if there are uncollapsed neighbor unions
        if (this.is_extendable()) this.show();
        // collapse if fully extended
        else this.hide();
        // update dag roots
        this.ft_datahandler.update_roots();
    }

    add_own_union(union_data) {
        // make union object
        const id = union_data.id || NODE_ID_PREFIX.UNION + ++this.ft_datahandler.number_nodes;
        const dagNode = new d3.dagNode(id, union_data);
        const union = new Union(dagNode, this.ft_datahandler, this.ft_datahandler.data);
        if (!("partner" in union_data)) union_data.partner = [this.id];
        if (!("children" in union_data)) {
            union_data.children = [];
            union._childLinkData = [];
        }
        union.data = union_data;
        this.ft_datahandler.nodes.push(union);
        // make sure union lists this person as a partner
        if (!union_data.partner.includes(this.id)) union_data.partner.push(this.id);
        // make sure this person lists union as own_union
        if (!this.data.own_unions.includes(union.id)) this.data.own_unions.push(union.id);
        if (!this._childLinkData.includes([this.id, union.id])) this._childLinkData.push([this.id, union.id]);
        // make union visible
        this.show_union(union);
        return union;
    }

    add_parent_union(union_data) {
        // make union object
        const id = union_data.id || NODE_ID_PREFIX.UNION + ++this.ft_datahandler.number_nodes;
        const dagNode = new d3.dagNode(id, union_data);
        const union = new Union(dagNode, this.ft_datahandler, this.ft_datahandler.data);
        if (!("partner" in union_data)) union_data.partner = [];
        if (!("children" in union_data)) {
            union_data.children = [this.id];
            union._childLinkData = [
                [union.id, this.id]
            ];
            union._children.push(this);
        }
        union.data = union_data;
        this.ft_datahandler.nodes.push(union);
        // make sure union lists this person as a child
        if (!union_data.children.includes(this.id)) union_data.children.push(this.id);
        // make sure this person lists union as own_union
        this.data.parent_union = union.id;
        // make union visible
        this.show_union(union);
        this.ft_datahandler.update_roots();
        return union;
    }

    _traverse(unions, related, visited = new Set()) {
        if (visited.has(this.id)) {
            return [];
        }

        visited.add(this.id);

        let results = [];

        unions(this).forEach(union => {
            related(union).forEach(node => {
                results.push(node);

                results.push(
                    ...node._traverse(
                        unions,
                        related,
                        visited
                    )
                );
            });
        });

        return [...new Set(results)];
    }

    get_ancestors() {
        return this._traverse(
            person => person.get_parent_unions(),
            union => union.get_parents(),
            new Set()
        );
    }

    get_descendants() {
        return this._traverse(
            person => person.get_own_unions(),
            union => union.get_children(),
            new Set()
        );
    }
}


function renderPersonTable(node) {
    const birthYear = node.get_birth_year();
    const birthPlace = node.data?.birthplace ?? "?";
    const deathYear = node.get_death_year();
    const deathPlace = node.data?.deathplace ?? "?";
    const summary = node.get_summary();

    const hasBirth = birthYear !== undefined;
    const hasDeath = deathYear !== undefined;
    const hasSummary = Array.isArray(summary) && summary.length > 0;

    if (!hasBirth && !hasDeath && !hasSummary) return "";

    const birthRow = hasBirth ? `
        <tr>
            <td>born</td>
            <td>${birthYear ?? "?"} in ${birthPlace}</td>
        </tr>` : "";

    const deathRow = hasDeath ? `
        <tr>
            <td>died</td>
            <td>${deathYear ?? "?"} in ${deathPlace}</td>
        </tr>` : "";

    const summaryRows = hasSummary ? `
        <tr><td colspan="2"><hr></td></tr>
        <tr>
            <td colspan="2">
                <ul>
                    ${summary.map(item => `<li>${item}</li>`).join("")}
                </ul>
            </td>
        </tr>` : "";

    return `<table style="margin-top: 5px;">${birthRow}${deathRow}${summaryRows}</table>`;
}

async function loadDiceBearAsync(imgElement, name) {
    imgElement.onload = null;

    if (AVATAR_CACHE.has(name)) {
        imgElement.src = AVATAR_CACHE.get(name);
        return;
    }

    try {
        const url = `${AVATAR_API_BASE}?seed=${encodeURIComponent(name)}`;
        const response = await fetch(url);
        const svgText = await response.text();

        const dataUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgText)}`;

        await new Promise((resolve, reject) => {
            imgElement.onload = resolve;
            imgElement.onerror = reject;
            imgElement.src = dataUrl;
        });

        if (AVATAR_CACHE.size >= MAX_CACHE_SIZE) {
            // evict oldest
            const firstKey = AVATAR_CACHE.keys().next().value;
            if (firstKey !== undefined) AVATAR_CACHE.delete(firstKey);
        }
        AVATAR_CACHE.set(name, dataUrl);

    } catch (e) {
        AVATAR_CACHE.delete(name);
        console.error("Initials load failed", e);
    }
}

function renderTooltip(node, {showImage = false} = {}) {
    const name = node.get_name() ?? "?";
    const personTable = renderPersonTable(node);

    const imageSection = showImage
        ? `
            <img 
                class="picImg"
                alt="Picture of ${name}"
                loading="lazy"
                data-avatar-name="${name}"
            />
        `
        : "";

    return `
        <div class="tooltip-content">
            ${imageSection}

            <div class="tooltip-text">
                <div class="tooltip-name">
                    ${showImage ? `<b>${name}</b>` : name}
                </div>
                ${personTable}
            </div>
        </div>
    `;
}


class TooltipRenderer {

    constructor() {
        this._div = d3.select("body").append("div")
            .attr("class", "tooltip")
            .style("opacity", 0);
    }

    show(event, node, tooltipFn) {
        const html = tooltipFn?.(node);
        if (!html) return;

        this._div
            .html(html)
            .transition()
            .duration(200)
            .style("opacity", undefined);

        const img = this._div.select("img.picImg").node();
        if (img) loadDiceBearAsync(img, img.dataset.avatarName);

        const divNode = this._div.node();

        const { height } = divNode.getBoundingClientRect();
        this._div
            .style("left", `${event.pageX + 10}px`)
            .style("top", `${event.pageY - height / 2}px`);
    }

    hide() {
        this._div.transition()
            .duration(500)
            .style("opacity", 0);
    }

    destroy() {
        this._div.remove();
    }
}

class FTDrawer {

    static label_delimiter = "_";

    constructor(
        ft_datahandler,
        svg,
        x0,
        y0,
    ) {
        this.ft_datahandler = ft_datahandler;
        this.svg = svg;
        this._orientation = null;
        this.link_css_class = "link";

        // append group element to draw family tree in
        this.g = this.svg.append("g");

        // initialize panning, zooming
        this.zoom = d3.zoom().on("zoom", event => this.g.attr("transform", event.transform));
        this.svg.call(this.zoom);

        // initialize tooltips
        this._tooltipRenderer = new TooltipRenderer();
        this.tooltip(FTDrawer.default_tooltip_func);

        // initialize dag layout maker
        this.layout = d3.sugiyama()
            .nodeSize([120, 120])
            .layering(d3.layeringSimplex())
            .decross(d3.decrossOpt)
            .coord(d3.coordVert());

        // defaults
        this.orientation("horizontal");
        this.transition_duration(TRANSITION.DEFAULT_DURATION);
        this.link_path(this.default_link_path_func.bind(this));
        this.node_label(FTDrawer.default_node_label_func);
        this.node_size(FTDrawer.default_node_size_func);
        this.node_class(FTDrawer.default_node_class_func);

        // set starting position for root node
        const default_pos = this.default_root_position();
        this.ft_datahandler.root.x0 = x0 || default_pos[0];
        this.ft_datahandler.root.y0 = y0 || default_pos[1];
    }

    static default_tooltip_func(node) {
        if (node.is_union()) return;

        return renderTooltip(node, {showImage: !!node.get_summary()?.length});
    }

    static default_node_label_func(node) {
        if (node.is_union()) return;

        const birthYear = node.get_birth_year();
        const deathYear = node.get_death_year();

        const hasBirthYear = birthYear != null;
        const hasDeathYear = deathYear != null;

        let displayLabel;

        if (hasBirthYear && hasDeathYear) {
            const age = deathYear - birthYear;
            displayLabel = `${birthYear} - ${deathYear} (${age} years)`;
        } else if (hasBirthYear) {
            displayLabel = `${birthYear} born`;
        } else {
            displayLabel = `${birthYear ?? "?"} - ${deathYear ?? "?"}`;
        }

        return `${node.get_name()}${FTDrawer.label_delimiter}${displayLabel}`;
    }

    static default_node_class_func(node) {
        // returns a node's css classes as a string
        if (node.is_union()) return undefined;

        return [
            "person",
            node.is_female() && "female",
            node.is_divorced() && "divorced",
            node.is_extendable() ? "extendable" : "non-extendable"
            ]
            .filter(Boolean)
            .join(" ");
    }

    static default_node_size_func(node) {
        // returns an integer determining the node's size
        if (node.is_union()) return 0;
        else return 10;
    }

    static make_unique_link_id(link) {
        return link.id || link.source.id + "_" + link.target.id;
    }

    default_link_path_func(s, d) {
        function vertical_s_bend(s, d) {
            // Creates a diagonal curve fit for vertically oriented trees
            return `M ${s.x} ${s.y} 
            C ${s.x} ${(s.y + d.y) / 2},
            ${d.x} ${(s.y + d.y) / 2},
            ${d.x} ${d.y}`
        }

        function horizontal_s_bend(s, d) {
            // Creates a diagonal curve fit for horizontally oriented trees
            return `M ${s.x} ${s.y}
            C ${(s.x + d.x) / 2} ${s.y},
              ${(s.x + d.x) / 2} ${d.y},
              ${d.x} ${d.y}`
        }

        return this._orientation == "vertical" ? vertical_s_bend(s, d) : horizontal_s_bend(s, d);
    }

    default_root_position() {
        return [
            this.svg.attr("width") / 2,
            this.svg.attr("height") / 2
        ]
    }

    orientation(value) {
        // getter/setter for tree orientation (horizontal/vertical)
        if (value) {
            this._orientation = value;
            return this;
        }
        return this._orientation;
    }

    node_separation(value) {
        // getter/setter for separation of nodes in x and y direction (see d3-dag documentation)
        if (value) {
            this.layout.nodeSize(value);
            return this;
        }
        return this.layout.nodeSize();
    }

    layering(value) {
        // getter/setter for layout operator (see d3-dag documentation)
        if (value) {
            this.layout.layering(value);
            return this;
        }
        return this.layout.layering();
    }

    decross(value) {
        // getter/setter for descross operator (see d3-dag documentation)
        if (value) {
            this.layout.decross(value);
            return this;
        }
        return this.layout.decross();

    }

    coord(value) {
        // getter/setter for coordinate operator (see d3-dag documentation)
        if (value) {
            this.layout.coord(value);
            return this;
        }
        return this.layout.coord();

    }

    transition_duration(value) {
        // getter/setter for animation transition duration
        if (value === undefined) {
            return this._transition_duration;
        }

        this._transition_duration = value;
        return this;
    }

    tooltip(tooltip_func) {
        // setter for tooltips
        if (tooltip_func) {
            this.show_tooltips = true;
            this._tooltip_func = tooltip_func;
        } else {
            this.show_tooltips = false;
        }
        return this;
    }

    node_label(node_label_func) {
        // setter for node labels
        if (node_label_func) {
            this.node_label_func = node_label_func
        }
        return this;
    }

    node_class(node_class_func) {
        // setter for node css class function
        if (node_class_func) {
            this.node_class_func = node_class_func
        }
        return this;
    }

    node_size(node_size_func) {
        // setter for node size function
        if (node_size_func) {
            this.node_size_func = node_size_func
        }
        return this;
    }

    link_path(link_path_func) {
        // setter for link path function
        if (link_path_func) {
            this.link_path_func = link_path_func
        }
        return this;
    }


    draw(source = this.ft_datahandler.root, collapsingNodes = []) {

        // get visible nodes and links
        const nodes = this.ft_datahandler.dag.descendants(),
            links = this.ft_datahandler.dag.links();

        const previousPositions = new Map();

        nodes.forEach(node => {
            previousPositions.set(node.id, {
                x: node.x,
                y: node.y
            });
        });

        // assign new x and y positions to all nodes
        this.layout(this.ft_datahandler.dag);

        const subtreeIds = new Set(
            this.get_subtree_nodes(source)
                .map(n => n.id)
        );

        nodes.forEach(node => {
            // preserve old position
            if (!subtreeIds.has(node.id)) {

                const old = previousPositions.get(node.id);

                if (old) {
                    node.x = old.x;
                    node.y = old.y;
                }
            }
        });

        // switch x and y coordinates if orientation = "horizontal"
        if (this._orientation === "horizontal") {
            let buffer = null;
            nodes.forEach(function (d) {
                buffer = d.x
                d.x = d.y;
                d.y = buffer;
            });
        }

        // ****************** Nodes section ***************************

        // assign node data
        let node = this.g.selectAll('g.node')
            .data(nodes, node => node.id)

        // insert new nodes at the parent's previous position.
        let nodeEnter = node.enter().append('g')
            .attr('class', 'node')
            .attr("transform", _ => `translate(${source.x0 ?? source.x ?? 0},${source.y0 ?? source.y ?? 0})`)
            .on("mouseenter", (_, node) => {
                if (node.is_union()) return;

                this.highlight_relationships(node);
            })
            .on("mouseleave", () => {
                this.clear_highlights();
                this.update_highlighting();
            })
            .on('click', (_, node) => {
                const collapsing = !node.is_extendable();

                let collapsingNodes = [];

                if (collapsing) {
                    collapsingNodes = this.get_descendants(node);
                }

                node.click();

                this.draw(node, collapsingNodes);
            }).attr('visible', true);

        // add tooltip
        if (this.show_tooltips) {
            const renderer = this._tooltipRenderer;
            const tooltipFn = this._tooltip_func;
            nodeEnter
                .on("mouseover", (event, d) => renderer.show(event, d, tooltipFn))
                .on("mouseout", () => renderer.hide());
        }

        // add a circle for each node
        nodeEnter.append('circle')
            .attr('class', this.node_class_func)
            .attr('r', 1e-6)

        // add node label
        nodeEnter.each((node, i, nodes) => {
            d3_append_multiline_text(
                d3.select(nodes[i]),
                this.node_label_func(node),
                FTDrawer.label_delimiter,
                "node-label",
            );
        });

        // UPDATE
        const nodeUpdate = nodeEnter.merge(node);

        // transition node to final coordinates
        const transition = d3.transition()
            .duration(this.transition_duration());

        nodeUpdate
            .transition(transition)
            .attr("transform", d => "translate(" + d.x + "," + d.y + ")");

        // update node style
        nodeUpdate.select('.node circle')
            .attr('r', this.node_size_func)
            .attr('class', this.node_class_func)
            .attr('cursor', 'pointer');

        let nodeExit = node.exit();

        const collapsingIds = new Set(
            collapsingNodes.map(n => n.id)
        );

        const nodeExitTransition = nodeExit
            .transition()
            .duration(this.transition_duration())
            .ease(d3.easeQuadInOut)
            .attr("transform", d => {
                // collapse toward clicked source node
                return `translate(${source.x},${source.y}) scale(0.1)`;
            })
            .style("opacity", TRANSITION.EXIT_OPACITY)
            .remove();

        // animation: shrink hidden nodes with transition
        nodeExit.select('circle')
            .transition()
            .duration(this.transition_duration())
            .ease(d3.easeQuadInOut)
            .attr('r', 1e-6)
            .style("opacity", TRANSITION.EXIT_OPACITY);

        nodeExit.select('text')
            .transition()
            .duration(this.transition_duration() * 0.8)
            .style('fill-opacity', 0)
            .style('opacity', 0);

        // ****************** links section ***************************

        // Update the links...
        let link = this.g.selectAll('path.' + this.link_css_class)
            .data(links, FTDrawer.make_unique_link_id);

        // Enter any new links at the parent's previous position.
        let linkEnter = link.enter().insert('path', "g")
            .attr("class", this.link_css_class)
            .attr('d', _ => {
                let o = {
                    x: source.x0,
                    y: source.y0
                }
                return this.link_path_func(o, o)
            });


        // UPDATE
        let linkUpdate = linkEnter.merge(link);

        // add union label
        linkUpdate.each(function (link) {
            //console.log("link: " + link);
            /*d3_append_multiline_text(
                d3.select(this),
                this_object.union_label_func(link),
                FTDrawer.label_delimiter,
                "node-label",
            )*/
        });

        // Transition back to the parent element position
        linkUpdate.transition()
            .duration(this.transition_duration())
            .attr('d', d => this.link_path_func(d.source, d.target));

        // Remove any existing links
        link.exit()
            .transition()
            .duration(this.transition_duration())
            .ease(d3.easeCubicInOut)
            .style("opacity", TRANSITION.EXIT_OPACITY)
            .attr('d', d => {
                const o = {
                    x: source.x,
                    y: source.y
                };

                return this.link_path_func(o, o);
            })
            .remove();

        // expanding a big subgraph moves the entire dag out of the screen
        // to prevent this, cancel any transformations in y-direction
        this.svg.transition()
            .delay((d, i) => i * 25)
            .duration(this.transition_duration())
            .call(
                this.zoom.transform,
                d3.zoomTransform(this.g.node()).translate(-(source.x - source.x0), -(source.y - source.y0)),
            );

        // store current node positions for next transition
        nodes.forEach(function (d) {
            d.x0 = d.x;
            d.y0 = d.y;
        });

    };

    clear() {
        this.g.selectAll("*").remove();
    }

    get_descendants(node) {
        const descendants = [];
        const visited = new Set();

        function recurse(current) {

            if (!current || visited.has(current.id)) return;

            visited.add(current.id);

            const neighbors = current.get_visible_neighbors?.() || [];

            neighbors.forEach(child => {
                descendants.push(child);
                recurse(child);
            });
        }

        recurse(node);

        return descendants;
    }

    clear_highlights() {
        this.ft_datahandler.nodes.forEach(node => {
            node.highlightType = null;
            node.dimmed = false;
        });
    }

    highlight_relationships(node) {
        this.clear_highlights();

        // dim everything first
        this.ft_datahandler.nodes.forEach(n => {
            n.dimmed = true;
        });

        // self
        node.highlightType = "self";
        node.dimmed = false;

        // ancestors
        node.get_ancestors?.().forEach(a => {
            a.highlightType = "ancestor";
            a.dimmed = false;
        });

        // descendants
        node.get_descendants?.().forEach(d => {
            d.highlightType = "descendant";
            d.dimmed = false;
        });

        // spouses
        node.get_spouses?.().forEach(s => {
            s.highlightType = "spouse";
            s.dimmed = false;
        });

        this.update_highlighting();
    }

    update_highlighting() {

        this.g.selectAll("g.node")
            .classed("highlight-self", d =>
                d.highlightType === "self"
            )
            .classed("highlight-ancestor", d =>
                d.highlightType === "ancestor"
            )
            .classed("highlight-descendant", d =>
                d.highlightType === "descendant"
            )
            .classed("highlight-spouse", d =>
                d.highlightType === "spouse"
            )
            .classed("dimmed", d =>
                d.dimmed
            );
    }

    get_subtree_nodes(root) {
        const result = [];
        const visited = new Set();

        const recurse = node => {
            if (!node || visited.has(node.id)) {
                return;
            }

            visited.add(node.id);

            result.push(node);

            const neighbors = node.get_visible_neighbors?.() || [];

            neighbors.forEach(recurse);
        };

        recurse(root);

        return result;
    }
}

class FamilyTree extends FTDrawer {

    constructor(data, svg) {
        const ft_datahandler = new FTDataHandler(data);
        super(ft_datahandler, svg);
    };

    get root() {
        return this.ft_datahandler.root;
    }

    wait_until_data_loaded(old_data, delay, tries, max_tries) {
        if (tries === max_tries) {
            return;
        } else {
            const new_data = globalThis.data;
            if (old_data === new_data) {
                setTimeout(
                    _ => this.wait_until_data_loaded(old_data, delay, ++tries, max_tries),
                    delay,
                )
            } else {
                this.draw_data(new_data);
                return;
            }
        }
    }

    draw_data(data) {
        let x0 = null,
            y0 = null;
        if (!this.root) {
            [x0, y0] = this.default_root_position();

        } else {
            [x0, y0] = [this.root.x0, this.root.y0];
        }
        this.ft_datahandler = new FTDataHandler(data);
        this.root.x0 = x0;
        this.root.y0 = y0;
        this.clear();
        this.draw();
    }

    load_data(path_to_data) {
        const old_data = data,
            max_tries = 5,
            delay = 1000,
            file = document.createElement('script');
        let tries = 0;
        file.onreadystatechange = function () {
            if (this.readyState == 'complete') {
                this.wait_until_data_loaded(old_data, delay, tries, max_tries);
            }
        }
        file.onload = () => this.wait_until_data_loaded(old_data, delay, tries, max_tries);
        file.type = "text/javascript";
        file.src = path_to_data;
        document.getElementsByTagName("head")[0].appendChild(file)
    }

}